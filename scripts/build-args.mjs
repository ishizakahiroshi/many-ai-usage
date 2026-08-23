const ALLOWED_TARGETS = new Set(['chrome', 'firefox']);

export function parseBuildArgs(argv) {
  let requestedTarget;
  let watch = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--watch') {
      watch = true;
      continue;
    }
    let value;
    if (arg === '--target') {
      value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--target requires chrome or firefox');
      index += 1;
    } else if (arg.startsWith('--target=')) {
      value = arg.slice('--target='.length);
      if (!value) throw new Error('--target requires chrome or firefox');
    } else {
      throw new Error(`unknown build argument: ${arg}`);
    }
    if (!ALLOWED_TARGETS.has(value)) throw new Error('target must be chrome or firefox');
    if (requestedTarget && requestedTarget !== value) throw new Error('target may only be specified once');
    requestedTarget = value;
  }
  return {
    targets: requestedTarget ? [requestedTarget] : ['chrome', 'firefox'],
    watch,
  };
}
