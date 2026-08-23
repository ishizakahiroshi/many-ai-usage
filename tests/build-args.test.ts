import { describe, expect, it } from 'vitest';
import { parseBuildArgs } from '../scripts/build-args.mjs';

describe('parseBuildArgs', () => {
  it('accepts space and equals target forms with identical results', () => {
    expect(parseBuildArgs(['--target', 'chrome'])).toEqual({ targets: ['chrome'], watch: false });
    expect(parseBuildArgs(['--target=chrome'])).toEqual({ targets: ['chrome'], watch: false });
    expect(parseBuildArgs(['--watch', '--target', 'firefox'])).toEqual({ targets: ['firefox'], watch: true });
  });

  it('defaults to both targets and rejects missing, unknown, or conflicting values', () => {
    expect(parseBuildArgs([])).toEqual({ targets: ['chrome', 'firefox'], watch: false });
    expect(() => parseBuildArgs(['--target'])).toThrow('--target requires');
    expect(() => parseBuildArgs(['--target=safari'])).toThrow('target must be');
    expect(() => parseBuildArgs(['--watc'])).toThrow('unknown build argument');
    expect(() => parseBuildArgs(['--target=chrome', '--target=firefox'])).toThrow('only be specified once');
  });
});
