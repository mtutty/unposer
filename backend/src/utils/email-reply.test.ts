import { stripQuotedReply } from './email-reply';

describe('stripQuotedReply', () => {
  it('leaves a plain reply with no quoting untouched', () => {
    const text = "I'm looking for staff engineer roles, remote only, in the $180-210k range.";
    expect(stripQuotedReply(text)).toBe(text);
  });

  it('cuts at a Gmail-style "On ... wrote:" attribution line', () => {
    const text = [
      "Sure, remote only works for me.",
      "",
      "On Thu, Aug 20, 2026 at 3:04 PM Unposer <onboarding@resend.dev> wrote:",
      "> What's your location preference?"
    ].join('\n');

    expect(stripQuotedReply(text)).toBe('Sure, remote only works for me.');
  });

  it('cuts at an Outlook-style "-----Original Message-----" marker', () => {
    const text = ['Yes, that timeline works.', '', '-----Original Message-----', 'From: Unposer'].join('\n');

    expect(stripQuotedReply(text)).toBe('Yes, that timeline works.');
  });

  it('cuts at the first run of >-quoted lines even without an attribution line', () => {
    const text = ['Comp flexibility matters more than title to me.', '> What matters most to you?'].join('\n');

    expect(stripQuotedReply(text)).toBe('Comp flexibility matters more than title to me.');
  });

  it('trims trailing whitespace left after the cut', () => {
    const text = 'Sounds good.\n\n\nOn Mon wrote:\n> hi';
    expect(stripQuotedReply(text)).toBe('Sounds good.');
  });
});
