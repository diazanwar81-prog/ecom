#!/usr/bin/env python3
"""Block 24: Telegram alerts on fulfill fail/ok (manual + auto)."""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "alertOps('FULFILL_FAILED'" in t:
    t = re.sub(r"block:\s*\d+", "block: 24", t, count=1)
    MAIN.write_text(t)
    print("Already has FULFILL alerts; bumped block 24")
    raise SystemExit(0)

# Manual fulfill failure
old_fail = (
    "    if (!result.ok) {\n"
    "      await writeAudit('FULFILL_FAILED', 'Order', id, result);\n"
    "      return { mode: MODE, error: 'fulfill_failed' /* telegram via catch below */, result };\n"
    "    }"
)
new_fail = (
    "    if (!result.ok) {\n"
    "      await writeAudit('FULFILL_FAILED', 'Order', id, result);\n"
    "      void alertOps('FULFILL_FAILED', {\n"
    "        orderId: id,\n"
    "        orderNumber: order.orderNumber,\n"
    "        error: result.error || 'fulfill_failed',\n"
    "        mock: result.mock,\n"
    "      });\n"
    "      return { mode: MODE, error: 'fulfill_failed', result };\n"
    "    }"
)
if old_fail in t:
    t = t.replace(old_fail, new_fail, 1)
    print("patched manual FULFILL_FAILED")
else:
    print("WARN: manual fulfill fail pattern not found")

# Manual fulfill success
old_ok = (
    "    await writeAudit('ORDER_FULFILLED', 'Order', id, result);\n"
    "    return {\n"
    "      mode: MODE,\n"
    "      fulfilled: true,\n"
)
new_ok = (
    "    await writeAudit('ORDER_FULFILLED', 'Order', id, result);\n"
    "    void alertOps('FULFILL_OK', {\n"
    "      orderId: id,\n"
    "      orderNumber: order.orderNumber,\n"
    "      supplierOrderId: result.supplierOrderId || '',\n"
    "      mock: result.mock,\n"
    "    });\n"
    "    return {\n"
    "      mode: MODE,\n"
    "      fulfilled: true,\n"
)
if old_ok in t and "alertOps('FULFILL_OK'" not in t:
    t = t.replace(old_ok, new_ok, 1)
    print("patched manual FULFILL_OK")

# Auto-fulfill failure
old_auto_fail = (
    "      if (!result.ok) {\n"
    "        await writeAudit('AUTO_FULFILL_FAILED', 'Order', order.id, result);\n"
    "        return {\n"
    "          mode: MODE,\n"
    "          order,\n"
    "          received: true,\n"
    "          autoFulfill: true,\n"
    "          fulfilled: false,\n"
    "          error: result.error,\n"
    "          cj: result,\n"
    "        };\n"
    "      }"
)
new_auto_fail = (
    "      if (!result.ok) {\n"
    "        await writeAudit('AUTO_FULFILL_FAILED', 'Order', order.id, result);\n"
    "        void alertOps('FULFILL_FAILED', {\n"
    "          orderId: order.id,\n"
    "          orderNumber: order.orderNumber,\n"
    "          error: result.error || 'auto_fulfill_failed',\n"
    "          auto: true,\n"
    "          mock: result.mock,\n"
    "        });\n"
    "        return {\n"
    "          mode: MODE,\n"
    "          order,\n"
    "          received: true,\n"
    "          autoFulfill: true,\n"
    "          fulfilled: false,\n"
    "          error: result.error,\n"
    "          cj: result,\n"
    "        };\n"
    "      }"
)
if old_auto_fail in t:
    t = t.replace(old_auto_fail, new_auto_fail, 1)
    print("patched AUTO_FULFILL_FAILED")
else:
    print("WARN: auto fulfill fail pattern not found")

# Auto-fulfill catch
old_catch = (
    "    } catch (e: any) {\n"
    "      await writeAudit('AUTO_FULFILL_ERROR', 'Order', order.id, { error: e?.message });\n"
    "      return {\n"
    "        mode: MODE,\n"
    "        order,\n"
    "        received: true,\n"
    "        autoFulfill: true,\n"
    "        fulfilled: false,\n"
    "        error: e?.message || 'auto_fulfill_error',\n"
    "      };\n"
    "    }"
)
new_catch = (
    "    } catch (e: any) {\n"
    "      await writeAudit('AUTO_FULFILL_ERROR', 'Order', order.id, { error: e?.message });\n"
    "      void alertOps('FULFILL_FAILED', {\n"
    "        orderId: order.id,\n"
    "        orderNumber: order.orderNumber,\n"
    "        error: e?.message || 'auto_fulfill_error',\n"
    "        auto: true,\n"
    "      });\n"
    "      return {\n"
    "        mode: MODE,\n"
    "        order,\n"
    "        received: true,\n"
    "        autoFulfill: true,\n"
    "        fulfilled: false,\n"
    "        error: e?.message || 'auto_fulfill_error',\n"
    "      };\n"
    "    }"
)
if old_catch in t:
    t = t.replace(old_catch, new_catch, 1)
    print("patched AUTO_FULFILL_ERROR")

t = re.sub(r"block:\s*\d+", "block: 24", t, count=1)
# boot message block number if present
t = t.replace("block: 22 });", "block: 24 });")
t = t.replace("block: 23 });", "block: 24 });")

MAIN.write_text(t)
print("Done block 24")
print("  FULFILL_FAILED:", "alertOps('FULFILL_FAILED'" in t)
print("  FULFILL_OK:", "alertOps('FULFILL_OK'" in t)
