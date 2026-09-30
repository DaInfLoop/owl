import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

console.log(JSON.stringify(parse(readFileSync('slack.manifest.yaml', 'utf8'))));
