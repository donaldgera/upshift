import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=new URL('../',import.meta.url);
const config=existsSync(new URL('wrangler.local.jsonc',root))?'wrangler.local.jsonc':'wrangler.jsonc';
const result=spawnSync(process.execPath,[fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js',root)),...process.argv.slice(2),'--config',config],{cwd:fileURLToPath(root),stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;
