#!/usr/bin/env python3
"""Wire startDiscoveryScheduler into apps/api/src/main.ts (idempotent)."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/api/src/main.ts"

def main():
    t = MAIN.read_text()
    if "startDiscoveryScheduler" in t and "block: 13" in t:
        print("Already block 13. Nothing to do.")
        return

    # import
    if "startDiscoveryScheduler" not in t:
        old = """import {
  enqueueDiscovery,
  enqueuePipeline,
  listRecentJobs,
  getQueueStatus,
  startWorkers,
} from '../../../packages/queue/src/index';"""
        new = """import {
  enqueueDiscovery,
  enqueuePipeline,
  listRecentJobs,
  getQueueStatus,
  startWorkers,
  startDiscoveryScheduler,
} from '../../../packages/queue/src/index';"""
        if old not in t:
            print("ERROR: queue import block not found — apply block 11 first")
            sys.exit(1)
        t = t.replace(old, new, 1)

    t = t.replace("block: 11,", "block: 13,", 1)

    # after startWorkers try/catch, call scheduler
    needle = "  } catch (e: any) {\n    console.warn('[queue] workers not started:', e?.message);\n  }"
    insert = """  } catch (e: any) {
    console.warn('[queue] workers not started:', e?.message);
  }
  try {
    startDiscoveryScheduler();
  } catch (e: any) {
    console.warn('[queue] scheduler not started:', e?.message);
  }"""
    if "startDiscoveryScheduler();" not in t:
        if needle not in t:
            print("ERROR: workers catch block not found")
            sys.exit(1)
        t = t.replace(needle, insert, 1)

    t = t.replace(
        "ECOM API block-11 (queue)",
        "ECOM API block-13 (scheduler)",
        1,
    )

    MAIN.write_text(t)
    print("Patched", MAIN)
    print("  startDiscoveryScheduler:", "startDiscoveryScheduler" in t)
    print("  block 13:", "block: 13" in t)

if __name__ == "__main__":
    main()
