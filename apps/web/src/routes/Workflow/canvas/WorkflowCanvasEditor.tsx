import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import { Trash2 } from "lucide-react";
import { SelectField, TextField } from "../../../components/forms/Field";
import { ActionFields, ConditionFields, DEPARTMENT_OPTIONS, TRIGGER_KINDS } from "../WorkflowConfigFields";
import { INTEGRATION_KINDS, NODE_META, NODE_ORDER, edgeId, fromPayload, newNodeId, toPayload, type CanvasEdge, type CanvasNode, type NodeData, type WfMetadata, type WfNodeType, type WfPayload } from "./graph";
import type { ValidationIssue } from "../../../api/versioning";

const DRAG_TYPE = "application/x-accuqual-node";
const APPROVER_ROLES = ["quality_manager", "admin", "auditor", "operator"];

// ---- The node as drawn on the canvas ------------------------------------------------------------------------------------------------------------

function WorkflowNodeView({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.node;
  const meta = NODE_META[node.type];
  const Icon = meta.icon;
  const summary =
    node.type === "condition"
      ? String((node.config as { field?: string }).field ?? "set a field")
      : node.type === "approval"
        ? String((node.config as { approverRole?: string; approverDepartment?: string }).approverRole ?? (node.config as { approverDepartment?: string }).approverDepartment ?? "choose an approver")
        : node.kind.replace(/_/g, " ");
  return (
    <div className={clsx("relative w-52 rounded-lg border-2 bg-card px-3 py-2 shadow-sm", meta.accent.split(" ")[0], selected && "ring-2 ring-primary/60", data.issueCount > 0 && "!border-destructive")}>
      {node.type !== "trigger" && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-muted-foreground" />}
      <div className="flex items-center gap-2">
        <Icon size={15} className={meta.accent.split(" ")[1]} />
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{meta.title}</span>
        {data.issueCount > 0 && <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">{data.issueCount}</span>}
      </div>
      <p className="mt-0.5 truncate text-sm font-medium">{node.label || summary}</p>
      {node.label && <p className="truncate text-xs text-muted-foreground">{summary}</p>}
      {meta.exits ? (
        meta.exits.map((exit, i) => (
          <div key={exit.id}>
            <Handle id={exit.id} type="source" position={Position.Right} style={{ top: `${i === 0 ? 34 : 70}%` }} className="!h-3 !w-3 !bg-primary" />
            <span className="pointer-events-none absolute -right-1 translate-x-full text-[10px] text-muted-foreground" style={{ top: `${i === 0 ? 34 : 70}%`, transform: "translate(100%, -50%)" }}>
              {exit.label}
            </span>
          </div>
        ))
      ) : node.type !== "end" ? (
        <Handle id="out" type="source" position={Position.Right} className="!h-3 !w-3 !bg-primary" />
      ) : null}
    </div>
  );
}

const nodeTypes = { wf: WorkflowNodeView };

// ---- Palette -----------------------------------------------------------------------------------------------------------------------------------

function Palette({ onAdd }: { onAdd: (type: WfNodeType) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</p>
      <p className="text-[11px] text-muted-foreground">Drag onto the canvas, or click to add.</p>
      {NODE_ORDER.map((type) => {
        const meta = NODE_META[type];
        const Icon = meta.icon;
        return (
          <div
            key={type}
            draggable
            onDragStart={(e: DragEvent) => {
              e.dataTransfer.setData(DRAG_TYPE, type);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onAdd(type)}
            className={clsx("flex cursor-grab items-center gap-2 rounded-md border-2 bg-card px-2 py-1.5 text-left hover:bg-muted active:cursor-grabbing", meta.accent.split(" ")[0])}
            title={meta.hint}
          >
            <Icon size={15} className={meta.accent.split(" ")[1]} />
            <span className="text-sm font-medium">{meta.title}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Inspector ---------------------------------------------------------------------------------------------------------------------------------

interface InspectorProps {
  node: CanvasNode | null;
  edge: CanvasEdge | null;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  editable: boolean;
  actionKinds: string[];
  onNodeChange: (id: string, patch: Partial<NodeData["node"]>) => void;
  onEdgeChange: (id: string, patch: { branch?: string; label?: string }) => void;
  onDelete: () => void;
}

function Inspector({ node, edge, nodes, editable, actionKinds, onNodeChange, onEdgeChange, onDelete }: InspectorProps) {
  if (!node && !edge) return <p className="text-sm text-muted-foreground">Select a step or a connection to edit it.</p>;

  if (edge) {
    const source = nodes.find((n) => n.id === edge.source);
    const exits = source ? NODE_META[source.data.node.type].exits : undefined;
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Connection</h3>
        <p className="text-xs text-muted-foreground">
          {source?.data.node.label || source?.data.node.kind} → {nodes.find((n) => n.id === edge.target)?.data.node.label || nodes.find((n) => n.id === edge.target)?.data.node.kind}
        </p>
        {exits ? (
          <SelectField label="Followed when" value={edge.data?.branch ?? ""} disabled={!editable} onChange={(e) => onEdgeChange(edge.id, { branch: e.target.value || undefined })}>
            <option value="">{source!.data.node.type === "approval" ? "Approved (default)" : "True (default)"}</option>
            {exits.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="text-xs text-muted-foreground">This step has one way out, so the connection is always followed.</p>
        )}
        <TextField label="Label (optional)" value={edge.data?.label ?? ""} disabled={!editable} onChange={(e) => onEdgeChange(edge.id, { label: e.target.value || undefined })} />
        {editable && <DeleteButton onClick={onDelete} label="Delete connection" />}
      </div>
    );
  }

  const n = node!.data.node;
  const meta = NODE_META[n.type];
  const setConfig = (config: Record<string, unknown>) => onNodeChange(n.id, { config });
  const cfg = n.config as Record<string, string | undefined>;
  return (
    <fieldset disabled={!editable} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{meta.title}</h3>
      <TextField label="Name on the canvas" placeholder={meta.title} value={n.label ?? ""} onChange={(e) => onNodeChange(n.id, { label: e.target.value || undefined })} />

      {n.type === "trigger" && (
        <>
          <TextField label="Event" list="wf-trigger-kinds" value={n.kind} onChange={(e) => onNodeChange(n.id, { kind: e.target.value })} />
          <datalist id="wf-trigger-kinds">
            {TRIGGER_KINDS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">The run starts when this event fires for the workflow's module.</p>
        </>
      )}

      {n.type === "condition" && <ConditionFields key={n.id} node={n} onChange={setConfig} />}

      {(n.type === "action" || n.type === "integration") && (
        <>
          <SelectField label={n.type === "action" ? "Action" : "Integration"} value={n.kind} onChange={(e) => onNodeChange(n.id, { kind: e.target.value, config: {} })}>
            {(n.type === "integration" ? INTEGRATION_KINDS : actionKinds.filter((k) => !INTEGRATION_KINDS.includes(k))).map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, " ")}
              </option>
            ))}
            {n.type === "action" && !actionKinds.includes(n.kind) && <option value={n.kind}>{n.kind} (not available)</option>}
          </SelectField>
          {n.kind === "erp_sync" ? <p className="text-xs text-muted-foreground">Runs the organization's configured ERP sync (the same one as “Trigger Sync Now”). Skipped, not faked, if no webhook is set.</p> : <ActionFields key={`${n.id}:${n.kind}`} node={n} onChange={setConfig} />}
        </>
      )}

      {n.type === "approval" && (
        <>
          <p className="text-xs text-muted-foreground">The run pauses here until someone with this role or in this department approves or rejects it.</p>
          <SelectField label="Approver role" value={cfg.approverRole ?? ""} onChange={(e) => setConfig({ ...n.config, approverRole: e.target.value || undefined })}>
            <option value="">Any</option>
            {APPROVER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
          <SelectField label="Approver department" value={cfg.approverDepartment ?? ""} onChange={(e) => setConfig({ ...n.config, approverDepartment: e.target.value || undefined })}>
            <option value="">Any</option>
            {DEPARTMENT_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
          <TextField label="What is being approved" value={cfg.message ?? ""} onChange={(e) => setConfig({ ...n.config, message: e.target.value || undefined })} />
          <p className="text-xs text-muted-foreground">Admins can always decide. Draw one connection labelled “approved” and, optionally, one labelled “rejected”.</p>
        </>
      )}

      {n.type === "parallel" && <p className="text-xs text-muted-foreground">Everything connected after this step runs, in the order the connections were drawn.</p>}
      {n.type === "end" && <p className="text-xs text-muted-foreground">Nothing runs after this step on this path.</p>}

      {editable && <DeleteButton onClick={onDelete} label="Delete step" />}
    </fieldset>
  );
}

function DeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex w-fit items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
      <Trash2 size={13} /> {label}
    </button>
  );
}

// ---- The editor ------------------------------------------------------------------------------------------------------------------------------------

export interface EditorHandle {
  /** Latest payload — read by the page for autosave and validation. */
  payload: WfPayload;
}

interface EditorProps {
  initial: WfPayload | undefined;
  editable: boolean;
  actionKinds: string[];
  issues: ValidationIssue[];
  onChange: (payload: WfPayload) => void;
  /** Rendered in the right-hand panel next to the inspector (checks, metadata, ...). */
  sidePanel: (ctx: { metadata: WfMetadata; setMetadata: (m: WfMetadata) => void; selectNode: (id: string) => void; inspector: React.ReactNode }) => React.ReactNode;
}

function EditorInner({ initial, editable, actionKinds, issues, onChange, sidePanel }: EditorProps) {
  const start = useMemo(() => fromPayload(initial), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(start.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(start.edges);
  const [metadata, setMetadata] = useState<WfMetadata>(start.metadata);
  const { screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // Tell the page about every real change (content or position), but not selection/measurement noise.
  const lastSent = useRef(JSON.stringify(toPayload(start.nodes, start.edges, start.metadata)));
  useEffect(() => {
    const payload = toPayload(nodes, edges, metadata);
    const json = JSON.stringify(payload);
    if (json !== lastSent.current) {
      lastSent.current = json;
      onChange(payload);
    }
  }, [nodes, edges, metadata, onChange]);

  const issueCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) if (i.nodeId) m.set(i.nodeId, (m.get(i.nodeId) ?? 0) + 1);
    return m;
  }, [issues]);
  const shownNodes = useMemo(() => nodes.map((n) => ((n.data.issueCount ?? 0) === (issueCounts.get(n.id) ?? 0) ? n : { ...n, data: { ...n.data, issueCount: issueCounts.get(n.id) ?? 0 } })), [nodes, issueCounts]);

  const selectedNode = nodes.find((n) => n.selected) ?? null;
  const selectedEdge = !selectedNode ? (edges.find((e) => e.selected) ?? null) : null;

  const addNode = useCallback(
    (type: WfNodeType, at?: { x: number; y: number }) => {
      const meta = NODE_META[type];
      // Clicking the palette drops the step near the middle of what is on screen (staggered so steps don't stack), not at an arbitrary origin.
      const box = wrapper.current?.getBoundingClientRect();
      const centre = box ? screenToFlowPosition({ x: box.left + box.width / 2 - 100, y: box.top + box.height / 2 - 40 }) : { x: 60, y: 60 };
      setNodes((ns) => {
        const id = newNodeId(ns);
        const position = at ?? { x: centre.x + (ns.length % 4) * 30 - 45, y: centre.y + (ns.length % 5) * 80 - 160 };
        return [...ns.map((n) => ({ ...n, selected: false })), { id, type: "wf" as const, position, selected: true, data: { node: { id, type, kind: meta.defaultKind, config: {} }, issueCount: 0 } }];
      });
    },
    [setNodes, screenToFlowPosition],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const branch = c.sourceHandle && c.sourceHandle !== "out" ? c.sourceHandle : undefined;
      const id = edgeId(c.source, c.target, branch);
      setEdges((es) => (es.some((e) => e.id === id) ? es : addEdge({ ...c, id, label: branch, data: { branch }, markerEnd: { type: MarkerType.ArrowClosed } }, es)));
    },
    [setEdges],
  );

  const isValidConnection = useCallback((c: { source: string; target: string }) => c.source !== c.target, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DRAG_TYPE) as WfNodeType;
    if (!type || !NODE_META[type]) return;
    addNode(type, screenToFlowPosition({ x: e.clientX - 100, y: e.clientY - 20 }));
  };

  const patchNode = (id: string, patch: Partial<NodeData["node"]>) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, node: { ...n.data.node, ...patch } } } : n)));
  const patchEdge = (id: string, patch: { branch?: string; label?: string }) =>
    setEdges((es) =>
      es.map((e) => {
        if (e.id !== id) return e;
        const data = { ...e.data, ...patch };
        return { ...e, id: edgeId(e.source, e.target, data.branch), sourceHandle: data.branch || "out", label: data.branch || data.label || undefined, data };
      }),
    );
  const deleteSelected = () => {
    if (selectedNode) {
      setNodes((ns) => ns.filter((n) => n.id !== selectedNode.id));
      setEdges((es) => es.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    } else if (selectedEdge) setEdges((es) => es.filter((e) => e.id !== selectedEdge.id));
  };

  const selectNode = (id: string) => setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));

  return (
    <div className="grid min-h-[36rem] gap-3 lg:h-[calc(100vh-17rem)] lg:grid-cols-[11rem_minmax(0,1fr)_20rem]">
      <div className="rounded-lg border border-border bg-card p-3">{editable ? <Palette onAdd={(t) => addNode(t)} /> : <p className="text-xs text-muted-foreground">This version is read-only. Start a draft to change the workflow.</p>}</div>

      <div ref={wrapper} className="min-h-[28rem] overflow-hidden rounded-lg border border-border bg-background" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow
          nodes={shownNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={editable ? onNodesChange : undefined}
          onEdgesChange={editable ? onEdgesChange : undefined}
          onConnect={editable ? onConnect : undefined}
          isValidConnection={isValidConnection}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="hsl(var(--muted-foreground))" maskColor="hsl(var(--background) / 0.7)" style={{ background: "hsl(var(--card))" }} />
        </ReactFlow>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-3">
        {sidePanel({
          metadata,
          setMetadata,
          selectNode,
          inspector: <Inspector node={selectedNode} edge={selectedEdge} nodes={nodes} edges={edges} editable={editable} actionKinds={actionKinds} onNodeChange={patchNode} onEdgeChange={patchEdge} onDelete={deleteSelected} />,
        })}
      </div>
    </div>
  );
}

/** The canvas. Remount it (change its `key`) to load a different version — it owns the nodes and edges while mounted. */
export function WorkflowCanvasEditor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}
