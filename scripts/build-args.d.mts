export interface BuildArgs {
  targets: Array<'chrome' | 'firefox'>;
  watch: boolean;
}

export function parseBuildArgs(argv: string[]): BuildArgs;
