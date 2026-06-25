"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
}
interface Webhook {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string;
  isActive: boolean;
}
interface Delivery {
  id: string;
  eventType: string;
  statusCode: number | null;
  success: boolean;
  error: string | null;
  attempt: number;
  createdAt: string;
}

export default function IntegrationsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keyModal, setKeyModal] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const [hookModal, setHookModal] = useState(false);
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState("*");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [k, h] = await Promise.all([
        api.get<ApiKey[]>("/integrations/api-keys"),
        api.get<Webhook[]>("/integrations/webhooks"),
      ]);
      setKeys(k);
      setHooks(h);
    } catch {
      setError("Could not load integrations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createKey = async () => {
    if (!keyName.trim()) return setFormError("Name is required");
    setSaving(true);
    setFormError(null);
    try {
      const res = await api.post<{ key: string }>("/integrations/api-keys", { name: keyName });
      setKeyModal(false);
      setKeyName("");
      setNewKey(res.key);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create key");
    } finally {
      setSaving(false);
    }
  };

  const revokeKey = async (k: ApiKey) => {
    try {
      await api.post(`/integrations/api-keys/${k.id}/revoke`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke");
    }
  };

  const deleteKey = async (k: ApiKey) => {
    if (!confirm(`Delete API key "${k.name}"?`)) return;
    try {
      await api.delete(`/integrations/api-keys/${k.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const createHook = async () => {
    if (!hookUrl.trim()) return setFormError("URL is required");
    setSaving(true);
    setFormError(null);
    try {
      const res = await api.post<{ secret: string }>("/integrations/webhooks", {
        url: hookUrl,
        eventTypes: hookEvents || "*",
      });
      setHookModal(false);
      setHookUrl("");
      setHookEvents("*");
      setNewSecret(res.secret);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to add webhook");
    } finally {
      setSaving(false);
    }
  };

  const testHook = async (h: Webhook) => {
    setTesting(h.id);
    setActionNote(null);
    try {
      const r = await api.post<{ success: boolean; statusCode: number | null; error: string | null }>(
        `/integrations/webhooks/${h.id}/test`
      );
      setActionNote(
        r.success
          ? `Test delivered to ${h.url} — HTTP ${r.statusCode}.`
          : `Test failed for ${h.url}: ${r.error ?? `HTTP ${r.statusCode}`}.`
      );
    } catch (err) {
      setActionNote(err instanceof ApiError ? err.message : "Test request failed");
    } finally {
      setTesting(null);
    }
  };

  const openDeliveries = async (h: Webhook) => {
    setDeliveriesFor(h);
    setDeliveriesLoading(true);
    try {
      setDeliveries(await api.get<Delivery[]>(`/integrations/webhooks/${h.id}/deliveries`));
    } catch {
      setDeliveries([]);
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const toggleHook = async (h: Webhook) => {
    try {
      await api.patch(`/integrations/webhooks/${h.id}`, { isActive: !h.isActive });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  const deleteHook = async (h: Webhook) => {
    if (!confirm("Delete this webhook?")) return;
    try {
      await api.delete(`/integrations/webhooks/${h.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  return (
    <>
      <PageHeader title="Integrations" subtitle="API keys & webhooks for external systems" />

      <ErrorNote message={error} />

      {newKey ? (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Copy your new API key now — it won&apos;t be shown again.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-sm text-amber-900">
            {newKey}
          </code>
          <button onClick={() => setNewKey(null)} className="mt-2 text-xs font-medium text-amber-800 hover:underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {newSecret ? (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Copy this webhook signing secret now — it won&apos;t be shown again. Verify each
            delivery&apos;s <code>X-Sreedo-Signature</code> (HMAC-SHA256 of the raw body) with it.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-sm text-amber-900">
            {newSecret}
          </code>
          <button onClick={() => setNewSecret(null)} className="mt-2 text-xs font-medium text-amber-800 hover:underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {actionNote ? (
        <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink">
          <span>{actionNote}</span>
          <button onClick={() => setActionNote(null)} className="text-xs font-medium text-muted hover:underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">API keys</h2>
              <Button onClick={() => { setKeyModal(true); setFormError(null); }}>+ New key</Button>
            </div>
            {keys.length === 0 ? (
              <EmptyState message="No API keys" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Key</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {keys.map((k) => (
                      <tr key={k.id} className="hover:bg-surface-2">
                        <td className="px-4 py-3 font-medium text-ink">{k.name}</td>
                        <td className="px-4 py-3"><code className="text-xs text-muted">{k.keyPrefix}…</code></td>
                        <td className="px-4 py-3">
                          <span className={k.isActive ? "text-green-700" : "text-muted"}>
                            {k.isActive ? "Active" : "Revoked"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            {k.isActive ? (
                              <button onClick={() => revokeKey(k)} className="text-xs font-medium text-amber-700 hover:underline">
                                Revoke
                              </button>
                            ) : null}
                            <button onClick={() => deleteKey(k)} className="text-xs font-medium text-red-600 hover:text-red-700">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Webhooks</h2>
              <Button onClick={() => { setHookModal(true); setFormError(null); }}>+ New webhook</Button>
            </div>
            {hooks.length === 0 ? (
              <EmptyState message="No webhook endpoints" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">URL</th>
                      <th className="px-4 py-3">Events</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {hooks.map((h) => (
                      <tr key={h.id} className="hover:bg-surface-2">
                        <td className="px-4 py-3 text-ink"><span className="break-all">{h.url}</span></td>
                        <td className="px-4 py-3 text-muted">{h.eventTypes}</td>
                        <td className="px-4 py-3">
                          <span className={h.isActive ? "text-green-700" : "text-muted"}>
                            {h.isActive ? "Active" : "Paused"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            <button onClick={() => testHook(h)} disabled={testing === h.id} className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50">
                              {testing === h.id ? "Testing…" : "Test"}
                            </button>
                            <button onClick={() => openDeliveries(h)} className="text-xs font-medium text-brand-600 hover:underline">
                              Log
                            </button>
                            <button onClick={() => toggleHook(h)} className="text-xs font-medium text-amber-700 hover:underline">
                              {h.isActive ? "Pause" : "Resume"}
                            </button>
                            <button onClick={() => deleteHook(h)} className="text-xs font-medium text-red-600 hover:text-red-700">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <Modal title="New API key" open={keyModal} onClose={() => setKeyModal(false)}>
        <div className="space-y-4">
          <Field label="Name">
            <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Zapier integration" />
          </Field>
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setKeyModal(false)}>Cancel</Button>
            <Button onClick={createKey} disabled={saving}>{saving ? "Creating…" : "Create"}</Button>
          </div>
        </div>
      </Modal>

      <Modal title="New webhook" open={hookModal} onClose={() => setHookModal(false)}>
        <div className="space-y-4">
          <Field label="Endpoint URL">
            <Input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Event types">
            <Input value={hookEvents} onChange={(e) => setHookEvents(e.target.value)} placeholder="* or e.g. student.created" />
          </Field>
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setHookModal(false)}>Cancel</Button>
            <Button onClick={createHook} disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        title={deliveriesFor ? `Deliveries — ${deliveriesFor.url}` : "Deliveries"}
        open={!!deliveriesFor}
        onClose={() => setDeliveriesFor(null)}
      >
        {deliveriesLoading ? (
          <Spinner />
        ) : deliveries.length === 0 ? (
          <EmptyState message="No delivery attempts yet" />
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase text-muted">
                <tr>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2 pr-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-3 text-ink">{d.eventType}</td>
                    <td className="py-2 pr-3">
                      <span className={d.success ? "text-green-700" : "text-red-600"}>
                        {d.success
                          ? `OK ${d.statusCode ?? ""}`
                          : `Failed ${d.statusCode ?? ""} ${d.error ?? ""}`.trim()}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-muted">{new Date(d.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}
