import { spawn } from 'node:child_process';
import path from 'node:path';
export async function evaluateNative(input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.resolve('src-tauri/target/debug/examples/evaluate'), [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      error = '';
    child.stdout.on('data', (b) => (output += b));
    child.stderr.on('data', (b) => (error += b));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(error));
      try {
        const result = JSON.parse(output);
        if (result.Err) reject(new Error(result.Err));
        else resolve(result.Ok);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
