import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField, SelectField } from "../../components/forms/Field";
import type { DigitalTwinModel, IotDevice, TwinNode } from "../../api/types";

const twinHooks = createResourceHooks<DigitalTwinModel>("digital-twin/models");
const deviceHooks = createResourceHooks<IotDevice>("digital-twin/devices");

const NODE_TYPES = ["machine", "process", "checkpoint", "operator"] as const;
const DEVICE_TYPES = ["plc", "sensor", "inspection_equipment", "environmental"] as const;

interface DraftNode {
  id: string;
  name: string;
  type: (typeof NODE_TYPES)[number];
  throughputPerHour: string;
}

function CreateModelForm() {
  const toast = useToast();
  const createModel = twinHooks.useCreate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<DraftNode[]>([{ id: "node-1", name: "", type: "machine", throughputPerHour: "" }]);

  const updateNode = (i: number, patch: Partial<DraftNode>) => setNodes((ns) => ns.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const modelJson: DigitalTwinModel["modelJson"] = {
          nodes: nodes
            .filter((n) => n.name)
            .map((n): TwinNode => ({ id: n.id, name: n.name, type: n.type, throughputPerHour: n.throughputPerHour ? Number(n.throughputPerHour) : undefined })),
          edges: [],
        };
        createModel.mutate(
          { name, description: description || undefined, modelJson } as never,
          {
            onSuccess: () => {
              toast.success("Model created.");
              setName("");
              setDescription("");
              setNodes([{ id: "node-1", name: "", type: "machine", throughputPerHour: "" }]);
            },
            onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create model.")),
          }
        );
      }}
    >
      <h3 className="text-sm font-medium">Create Model</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Nodes (machines / processes / checkpoints / operators)</p>
        {nodes.map((node, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
            <TextField label="Name" value={node.name} onChange={(e) => updateNode(i, { name: e.target.value })} />
            <SelectField label="Type" value={node.type} onChange={(e) => updateNode(i, { type: e.target.value as DraftNode["type"] })}>
              {NODE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectField>
            <TextField label="Throughput/hr" type="number" value={node.throughputPerHour} onChange={(e) => updateNode(i, { throughputPerHour: e.target.value })} />
            <button
              type="button"
              onClick={() => setNodes((ns) => (ns.length === 1 ? ns : ns.filter((_, idx) => idx !== i)))}
              disabled={nodes.length === 1}
              className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setNodes((ns) => [...ns, { id: `node-${ns.length + 1}`, name: "", type: "machine", throughputPerHour: "" }])} className="w-fit text-sm text-primary hover:underline">
          + Add node
        </button>
      </div>

      <button type="submit" disabled={createModel.isPending || !name} className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {createModel.isPending ? "Creating…" : "Create Model"}
      </button>
    </form>
  );
}

function RegisterDeviceForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: models = [] } = twinHooks.useList();
  const [deviceId, setDeviceId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("");
  const [modelId, setModelId] = useState("");

  const register = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/digital-twin/devices", {
          deviceId,
          name: name || undefined,
          type: type || undefined,
          digitalTwinModelId: modelId ? Number(modelId) : undefined,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["digital-twin/devices"] });
      toast.success("Device registered.");
      setDeviceId("");
      setName("");
      setType("");
      setModelId("");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't register device.")),
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        register.mutate();
      }}
    >
      <h3 className="text-sm font-medium">Register IoT Device</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Device ID" required value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="sensor-42" />
        <TextField label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Type (optional)" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Unspecified</option>
          {DEVICE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <SelectField label="Linked Model (optional)" value={modelId} onChange={(e) => setModelId(e.target.value)}>
          <option value="">None</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
      </div>
      <button type="submit" disabled={register.isPending || !deviceId} className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {register.isPending ? "Registering…" : "Register Device"}
      </button>
    </form>
  );
}

/** Inline edit row for one device — name/type/linked model, matching RegisterDeviceForm's own field set (everything but deviceId, which is immutable — see updateDeviceSchema's own comment). */
function EditDeviceRow({ device, models, onDone }: { device: IotDevice; models: DigitalTwinModel[]; onDone: () => void }) {
  const toast = useToast();
  const update = deviceHooks.useUpdate();
  const [name, setName] = useState(device.name ?? "");
  const [type, setType] = useState(device.type ?? "");
  const [modelId, setModelId] = useState(device.digitalTwinModelId ? String(device.digitalTwinModelId) : "");

  const save = () => {
    update.mutate(
      { id: device.id, name: name || null, type: (type || null) as IotDevice["type"], digitalTwinModelId: modelId ? Number(modelId) : null },
      {
        onSuccess: () => {
          toast.success("Device updated.");
          onDone();
        },
        onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update device.")),
      }
    );
  };

  return (
    <tr className="border-t border-border bg-muted/40">
      <td className="py-1.5 font-medium">{device.deviceId}</td>
      <td className="py-1.5">
        <TextField label="" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      </td>
      <td className="py-1.5">
        <SelectField label="" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Unspecified</option>
          {DEVICE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
      </td>
      <td className="py-1.5">
        <SelectField label="" value={modelId} onChange={(e) => setModelId(e.target.value)}>
          <option value="">None</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
      </td>
      <td className="py-1.5 text-right">
        <div className="flex justify-end gap-2">
          <button type="button" onClick={save} disabled={update.isPending} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60">
            {update.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onDone} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function RegisteredDevices() {
  const toast = useToast();
  const { data: devices = [] } = deviceHooks.useList();
  const { data: models = [] } = twinHooks.useList();
  const deleteDevice = deviceHooks.useDelete();
  const [editingId, setEditingId] = useState<number | null>(null);

  if (devices.length === 0) return <p className="text-sm text-muted-foreground">No devices registered yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="pb-2">Device ID</th>
          <th className="pb-2">Name</th>
          <th className="pb-2">Type</th>
          <th className="pb-2">Linked Model</th>
          <th className="pb-2">Last Seen</th>
          <th className="pb-2" />
        </tr>
      </thead>
      <tbody>
        {devices.map((d) =>
          editingId === d.id ? (
            <EditDeviceRow key={d.id} device={d} models={models} onDone={() => setEditingId(null)} />
          ) : (
            <tr key={d.id} className="border-t border-border">
              <td className="py-1.5 font-medium">{d.deviceId}</td>
              <td className="py-1.5">{d.name ?? "—"}</td>
              <td className="py-1.5 capitalize">{d.type?.replace(/_/g, " ") ?? "—"}</td>
              <td className="py-1.5">{models.find((m) => m.id === d.digitalTwinModelId)?.name ?? "—"}</td>
              <td className="py-1.5 text-muted-foreground">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "Never (not ingesting yet)"}</td>
              <td className="py-1.5 text-right">
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditingId(d.id)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      deleteDevice.mutate(d.id, {
                        onSuccess: () => toast.success("Device removed."),
                        onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove device.")),
                      })
                    }
                    className="rounded-md border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

export function AdminDigitalTwinSetupPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Digital Twin Setup</h1>
        <Link to="/digital-twin" className="text-sm text-primary hover:underline">
          Go to Digital Twin →
        </Link>
      </div>
      <AdminOnlyGuard>
        <div className="grid gap-4 lg:grid-cols-2">
          <CreateModelForm />
          <RegisterDeviceForm />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Registered Devices</h3>
          <RegisteredDevices />
        </div>
        <p className="text-xs text-muted-foreground">
          To run a simulation against a model, use the{" "}
          <Link to="/digital-twin" className="text-primary hover:underline">
            Digital Twin
          </Link>{" "}
          page — that's the same real endpoint this setup page's models feed into.
        </p>
      </AdminOnlyGuard>
    </div>
  );
}
