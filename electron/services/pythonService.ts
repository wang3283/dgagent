import { spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';

export class PythonService {
  private pythonPath: string;

  constructor() {
    // Auto-detect python path or use a bundled one
    // For now, assume 'python3' or 'python' is in PATH
    this.pythonPath = process.platform === 'win32' ? 'python' : 'python3';
  }

  public async runCode(code: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Simple safety check (very basic)
      if (code.includes('import os') || code.includes('import sys') || code.includes('subprocess')) {
        // reject(new Error('Security Warning: System access modules are restricted in this environment.'));
        // For MVP, we just warn but allow, relying on User Trust for local app
        console.warn('[PythonService] Warning: Code contains system modules.');
      }

      const pythonProcess = spawn(this.pythonPath, ['-c', code]);

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          resolve(`Execution failed (Exit code ${code}):\n${stderr}`);
        } else {
          // Combine stdout and stderr (sometimes warnings go to stderr)
          resolve(stdout || stderr || '[No output]');
        }
      });

      pythonProcess.on('error', (err) => {
        reject(new Error(`Failed to start Python process: ${err.message}`));
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        pythonProcess.kill();
        resolve('Execution timed out after 10 seconds.');
      }, 10000);
    });
  }
}

export const pythonService = new PythonService();
