import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

interface WSMessage {
  event: string;
  payload: any;
}

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private ws: WebSocket | null = null;
  private messageSubject = new Subject<WSMessage>();
  private connectedSubject = new Subject<boolean>();
  // Bumped on every connect()/disconnect() call. Since this service is a singleton shared across
  // every step's ChatPanelComponent, and the rail now lets a candidate jump straight back into a
  // previously-completed step's chat, a fast nav (e.g. tapping two rail entries before the first
  // socket finishes opening/closing) can leave a superseded socket's onopen/onmessage/onclose
  // still pending. Without this guard, a late event from that abandoned socket lands on the
  // *current* subjects — e.g. a stale open firing a fresh chat:resume that clobbers the new step's
  // history request, or a stale close flipping connectedSubject false right after the real
  // connection came up — which is what read as "blank chat, no prompt" / "wrong section" on the
  // rail. Each connect() captures its own token and every handler below checks it's still current
  // before touching shared state.
  private connectionToken = 0;

  /**
   * Live chat only exists for 'logistics' (app channel) and 'deep_prompts' — see spec Step 4/5.
   * No token is passed here: the session lives in an httpOnly cookie, which the browser attaches
   * to this same-origin WS handshake automatically; the server reads it off the upgrade request.
   */
  connect(step: 'logistics' | 'deep_prompts'): void {
    if (this.ws) {
      this.ws.close();
    }

    const token = ++this.connectionToken;
    const isCurrent = () => token === this.connectionToken;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?step=${step}`;
    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    socket.onopen = () => {
      if (!isCurrent()) return;
      this.connectedSubject.next(true);
      this.send('chat:resume', {});
    };

    socket.onmessage = (event) => {
      if (!isCurrent()) return;
      const message = JSON.parse(event.data);
      this.messageSubject.next(message);
    };

    socket.onerror = (error) => {
      if (!isCurrent()) return;
      console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
      if (!isCurrent()) return;
      this.connectedSubject.next(false);
    };
  }

  send(event: string, payload: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, payload }));
    }
  }

  on(event: string): Observable<any> {
    return new Observable((observer) => {
      const subscription = this.messageSubject.subscribe((message) => {
        if (message.event === event) {
          observer.next(message.payload);
        }
      });

      return () => subscription.unsubscribe();
    });
  }

  connected(): Observable<boolean> {
    return this.connectedSubject.asObservable();
  }

  disconnect(): void {
    this.connectionToken++; // supersede whatever handlers are still attached to this.ws
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
