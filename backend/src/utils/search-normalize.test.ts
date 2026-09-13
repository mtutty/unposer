import { parseRemotePreference } from './search-normalize';

describe('parseRemotePreference', () => {
  it('returns null for empty/missing input', () => {
    expect(parseRemotePreference(null)).toBeNull();
    expect(parseRemotePreference(undefined)).toBeNull();
    expect(parseRemotePreference('')).toBeNull();
  });

  it('detects remote', () => {
    expect(parseRemotePreference('Fully remote, anywhere in the US')).toBe('remote');
    expect(parseRemotePreference('Prefer WFH')).toBe('remote');
    expect(parseRemotePreference('Looking for a fully distributed team')).toBe('remote');
  });

  it('detects onsite', () => {
    expect(parseRemotePreference('Onsite in Austin only')).toBe('onsite');
    expect(parseRemotePreference('In-office 5 days a week')).toBe('onsite');
    expect(parseRemotePreference('No remote work considered')).toBe('onsite');
  });

  it('prefers hybrid over a co-occurring remote mention', () => {
    expect(parseRemotePreference('Open to hybrid or fully remote')).toBe('hybrid');
  });

  it('returns null when the text does not mention any known bucket', () => {
    expect(parseRemotePreference('Open to relocating for the right role')).toBeNull();
  });
});
