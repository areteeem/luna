import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=[path.join(root,'.venv/bin/python'),path.join(root,'../research-env/bin/python')].find(existsSync);
if(!python)throw new Error('Run uv sync --frozen in the repository root first.');
const processChild=spawn(python,process.argv.slice(2),{cwd:root,stdio:'inherit'});processChild.on('exit',code=>process.exit(code||0));processChild.on('error',error=>{console.error(error.message);process.exit(1)});
