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

  /**
   * Live chat only exists for 'logistics' (app channel) and 'deep_prompts' — see spec Step 4/5.
   * No token is passed here: the session lives in an httpOnly cookie, which the browser attaches
   * to this same-origin WS handshake automatically; the server reads it off the upgrade request.
   */
  connect(step: 'logistics' | 'deep_prompts'): void {
    if (this.ws) {
      this.ws.close();
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?step=${step}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connectedSubject.next(true);
      this.send('chat:resume', {});
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.messageSubject.next(message);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
