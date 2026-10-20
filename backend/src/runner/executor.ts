    const success = results.length > 0 && results.every((r) => r.passed);

    // --- TRACE CAPTURE (opt-in, after results parsed, before cleanup) ---
    if (options?.trace) {
      // Playwright --trace on produces trace.zip under <outputDir>/<test-dir>/
      // We need to find it before runDir cleanup.
      let traceZipPath: string | undefined;
      const artifactsDir = path.join(runDir, 'artifacts');
      try {
        const entries = await fs.readdir(artifactsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // depth ≤ 3: artifacts/<test-dir>/...
            const subEntries = await fs.readdir(path.join(artifactsDir, entry.name), { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.name.startsWith('trace') && subEntry.name.endsWith('.zip')) {
                const candidatePath = path.join(artifactsDir, entry.name, subEntry.name);
                // pick largest by size
                if (traceZipPath === undefined || (await fs.stat(candidatePath)).size > (await fs.stat(traceZipPath)).size) {
                  traceZipPath = candidatePath;
                }
              }
            }
          }
        }
      } catch (_err) {
        // artifacts dir may be empty/missing; no trace to capture
      }
      if (traceZipPath && options.onTraceZip) {
        try {
          await options.onTraceZip(traceZipPath);
        } catch (onErr) {
          console.warn(`[Executor] onTraceZip handler failed:`, onErr);
        }
      }
    }

    const success = results.length > 0 && results.every((r) => r.passed);

    if (options?.trace) {
      // Playwright --trace on produces trace.zip under <outputDir>/<test-dir>/
      // We need to find it before runDir cleanup.
      let traceZipPath: string | undefined;
      const artifactsDir = path.join(runDir, 'artifacts');
      try {
        const entries = await fs.readdir(artifactsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // depth ≤ 3: artifacts/<test-dir>/...
            const subEntries = await fs.readdir(path.join(artifactsDir, entry.name), { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.name.startsWith('trace') && subEntry.name.endsWith('.zip')) {
                const candidatePath = path.join(artifactsDir, entry.name, subEntry.name);
                // pick largest by size
                if (traceZipPath === undefined || (await fs.stat(candidatePath)).size > (await fs.stat(traceZipPath)).size) {
                  traceZipPath = candidatePath;
                }
              }
            }
          }
        }
      } catch (_err) {
        // artifacts dir may be empty/missing; no trace to capture
      }
      if (traceZipPath && options.onTraceZip) {
        try {
          await options.onTraceZip(traceZipPath);
        } catch (onErr) {
          console.warn(`[Executor] onTraceZip handler failed:`, onErr);
        }
      }
    }

    // 5. Cleanup: reapRunner BEFORE fs.rm
      try {
        await reapRunner();
      } catch {
        // Ignore reaper error
      }
      try {
        await fs.rm(resultsPath, { force: true });
      } catch {
        // Ignore cleanup error
      }
      try {
        await fs.rm(runDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
  });
}
