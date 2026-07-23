"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Team, Rep } from "@/lib/types";

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTeam, setNewTeam] = useState<Partial<Team>>({ name: "", managerName: "", managerEmail: "", managerCell: "", area: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Team>>({});
  const [saving, setSaving] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [draggingRepId, setDraggingRepId] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  // Counter-based drag enter/leave tracking per drop zone (handles child elements)
  const dragCounters = useRef<Map<string, number>>(new Map());

  const load = () => {
    Promise.all([
      fetch("/api/teams").then((r) => r.json()),
      fetch("/api/reps").then((r) => r.json()),
    ]).then(([t, r]) => {
      setTeams(t);
      setReps(r);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const repsByTeam = useMemo(() => {
    const map = new Map<string, Rep[]>();
    reps.forEach((r) => {
      const tid = r.teamId || "unassigned";
      const arr = map.get(tid) || [];
      arr.push(r);
      map.set(tid, arr);
    });
    return map;
  }, [reps]);

  const unassignedReps = useMemo(() => reps.filter((r) => !r.teamId), [reps]);

  const addTeam = async () => {
    setSaving(true);
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTeam),
    });
    setShowAdd(false);
    setNewTeam({ name: "", managerName: "", managerEmail: "", managerCell: "", area: "" });
    setSaving(false);
    load();
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/teams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const deleteTeam = async (id: string) => {
    if (!confirm("Delete this team? Reps will become unassigned.")) return;
    const teamReps = repsByTeam.get(id) || [];
    for (const rep of teamReps) {
      await fetch("/api/reps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rep.id, teamId: "" }),
      });
    }
    await fetch("/api/teams", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  };

  const removeRepFromTeam = async (repId: string) => {
    await fetch("/api/reps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: repId, teamId: "" }),
    });
    load();
  };

  // ── Drag & Drop ──
  // Uses counter-based enter/leave to handle child elements reliably.
  // Optimistic UI update on drop so the rep moves instantly.

  const handleDragStart = (e: React.DragEvent, repId: string) => {
    e.dataTransfer.setData("application/x-rep-id", repId);
    e.dataTransfer.effectAllowed = "move";
    // Delay so the dragged ghost renders before we dim the source
    requestAnimationFrame(() => setDraggingRepId(repId));
  };

  const handleDragEnd = () => {
    setDraggingRepId(null);
    setDragOverTarget(null);
    dragCounters.current.clear();
  };

  const handleDragEnter = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const count = (dragCounters.current.get(targetId) || 0) + 1;
    dragCounters.current.set(targetId, count);
    if (count === 1) setDragOverTarget(targetId);
  };

  const handleDragLeave = (_e: React.DragEvent, targetId: string) => {
    const count = (dragCounters.current.get(targetId) || 1) - 1;
    dragCounters.current.set(targetId, count);
    if (count <= 0) {
      dragCounters.current.set(targetId, 0);
      setDragOverTarget((prev) => (prev === targetId ? null : prev));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, targetTeamId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Reset drag visuals
    dragCounters.current.clear();
    setDragOverTarget(null);
    setDraggingRepId(null);

    if (dropping) return; // prevent double drops

    const repId = e.dataTransfer.getData("application/x-rep-id");
    if (!repId) return;

    const rep = reps.find((r) => r.id === repId);
    if (!rep) return;

    const newTeamId = targetTeamId === "unassigned" ? "" : targetTeamId;
    const currentTeamId = rep.teamId || "";

    if (currentTeamId === newTeamId) return; // no-op

    // Optimistic update: move the rep in local state immediately
    setReps((prev) =>
      prev.map((r) => (r.id === repId ? { ...r, teamId: newTeamId } : r))
    );

    // Persist to server
    setDropping(true);
    try {
      const res = await fetch("/api/reps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: repId, teamId: newTeamId }),
      });
      if (!res.ok) {
        // Revert on failure
        load();
      }
    } catch {
      load(); // revert
    } finally {
      setDropping(false);
    }
  };

  // ── Drop zone wrapper props ──
  const dropZoneProps = (targetId: string) => ({
    onDragEnter: (e: React.DragEvent<HTMLDivElement>) => handleDragEnter(e, targetId),
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => handleDragLeave(e, targetId),
    onDragOver: handleDragOver,
    onDrop: (e: React.DragEvent<HTMLDivElement>) => handleDrop(e, targetId),
  });

  // ── Draggable rep props ──
  const draggableProps = (repId: string) => ({
    draggable: !dropping,
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => handleDragStart(e, repId),
    onDragEnd: handleDragEnd,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Teams &amp; Area Managers</h1>
          <p className="text-sm text-gray-500">{teams.length} teams, {unassignedReps.length} unassigned reps</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark"
        >
          + New Team
        </button>
      </div>

      {/* Drag hint */}
      {unassignedReps.length > 0 && (
        <p className="text-xs text-gray-400">Drag reps into a team card to assign them.</p>
      )}

      {/* Add Team Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Create Team</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: "name", label: "Team Name", placeholder: "e.g. Gauteng North" },
              { key: "area", label: "Area", placeholder: "e.g. Pretoria, Centurion, Midrand" },
              { key: "managerName", label: "Manager Name", placeholder: "Full Name" },
              { key: "managerEmail", label: "Manager Email", placeholder: "email@company.com" },
              { key: "managerCell", label: "Manager Cell", placeholder: "+27..." },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input
                  value={(newTeam as Record<string, string>)[key] || ""}
                  onChange={(e) => setNewTeam({ ...newTeam, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={addTeam} disabled={saving} className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50">
              {saving ? "Creating..." : "Create Team"}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}

      {/* Team Cards — Drop Zones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {teams.map((team) => {
          const teamReps = repsByTeam.get(team.id) || [];
          const isEditing = editing === team.id;
          const isDropTarget = dragOverTarget === team.id;

          return (
            <div
              key={team.id}
              {...dropZoneProps(team.id)}
              className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden transition-all duration-150 ${
                isDropTarget
                  ? "border-iram-green bg-red-50/30 shadow-md scale-[1.01]"
                  : "border-gray-100"
              }`}
            >
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                {isEditing ? (
                  <div className="flex-1 grid grid-cols-2 gap-2 mr-4">
                    <input value={editData.name || ""} onChange={(e) => setEditData({ ...editData, name: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Team Name" />
                    <input value={editData.area || ""} onChange={(e) => setEditData({ ...editData, area: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Area" />
                    <input value={editData.managerName || ""} onChange={(e) => setEditData({ ...editData, managerName: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Manager Name" />
                    <input value={editData.managerEmail || ""} onChange={(e) => setEditData({ ...editData, managerEmail: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Manager Email" />
                    <input value={editData.managerCell || ""} onChange={(e) => setEditData({ ...editData, managerCell: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Manager Cell" />
                  </div>
                ) : (
                  <div>
                    <h3 className="font-semibold text-gray-900">{team.name}</h3>
                    <p className="text-xs text-gray-500">{team.area}</p>
                  </div>
                )}
                <div className="flex gap-2 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <button onClick={() => saveEdit(team.id)} className="text-green-600 text-xs font-medium">Save</button>
                      <button onClick={() => { setEditing(null); setEditData({}); }} className="text-gray-400 text-xs font-medium">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditing(team.id); setEditData({ ...team }); }} className="text-iram-green text-xs font-medium">Edit</button>
                      <button onClick={() => deleteTeam(team.id)} className="text-gray-400 text-xs font-medium">Delete</button>
                    </>
                  )}
                </div>
              </div>

              {/* Manager info */}
              {!isEditing && (
                <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
                  <p className="text-xs text-blue-600">
                    <span className="font-medium">Manager:</span> {team.managerName || "Not assigned"}
                    {team.managerEmail && <span className="ml-2 text-blue-400">{team.managerEmail}</span>}
                    {team.managerCell && <span className="ml-2 text-blue-400">{team.managerCell}</span>}
                  </p>
                </div>
              )}

              {/* Reps list */}
              <div className="px-6 py-3 min-h-[60px]">
                <span className="text-xs font-medium text-gray-500 uppercase mb-2 block">
                  Reps ({teamReps.length})
                </span>

                {teamReps.length === 0 && (
                  <div className={`border-2 border-dashed rounded-lg py-4 text-center text-xs font-medium transition-colors ${
                    isDropTarget
                      ? "border-iram-green/40 text-iram-green bg-red-50/50"
                      : "border-gray-200 text-gray-400"
                  }`}>
                    {isDropTarget ? "Drop here to assign" : "Drag reps here"}
                  </div>
                )}

                {teamReps.length > 0 && (
                  <div className="space-y-1">
                    {teamReps.map((rep) => (
                      <div
                        key={rep.id}
                        {...draggableProps(rep.id)}
                        className={`flex items-center justify-between py-1.5 px-2 rounded-md border border-transparent hover:border-gray-200 transition-opacity select-none ${
                          dropping ? "" : "cursor-grab active:cursor-grabbing"
                        } ${draggingRepId === rep.id ? "opacity-20" : ""}`}
                      >
                        <div className="flex items-center gap-2 pointer-events-none">
                          <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm6 0a2 2 0 10.001 4.001A2 2 0 0013 2zM7 8a2 2 0 10.001 4.001A2 2 0 007 8zm6 0a2 2 0 10.001 4.001A2 2 0 0013 8zM7 14a2 2 0 10.001 4.001A2 2 0 007 14zm6 0a2 2 0 10.001 4.001A2 2 0 0013 14z" />
                          </svg>
                          <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{rep.code}</span>
                          <span className="text-sm text-gray-900">{rep.name}</span>
                        </div>
                        <button
                          onClick={() => removeRepFromTeam(rep.id)}
                          className="text-xs text-gray-400 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    {/* Drop indicator when dragging over a team that has reps */}
                    {isDropTarget && (
                      <div className="border-2 border-dashed border-iram-green/40 rounded-lg py-2 text-center text-xs text-iram-green font-medium mt-1">
                        Drop here to assign
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unassigned Reps — also a drop target */}
      <div
        {...dropZoneProps("unassigned")}
        className={`rounded-xl border-2 p-6 transition-all duration-150 ${
          dragOverTarget === "unassigned"
            ? "border-amber-400 bg-amber-50 shadow-md"
            : unassignedReps.length > 0
              ? "border-amber-200 bg-amber-50"
              : "border-dashed border-gray-200 bg-gray-50"
        }`}
      >
        <h3 className={`font-semibold mb-3 ${unassignedReps.length > 0 ? "text-amber-800" : "text-gray-400"}`}>
          Unassigned Reps ({unassignedReps.length})
        </h3>

        {unassignedReps.length === 0 && !draggingRepId && (
          <p className="text-xs text-gray-400 italic">All reps are assigned to teams</p>
        )}

        {unassignedReps.length === 0 && draggingRepId && (
          <div className={`border-2 border-dashed rounded-lg py-4 text-center text-xs font-medium transition-colors ${
            dragOverTarget === "unassigned"
              ? "border-amber-400 text-amber-600 bg-amber-100/50"
              : "border-amber-300/50 text-amber-500"
          }`}>
            Drop here to unassign from team
          </div>
        )}

        {unassignedReps.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unassignedReps.map((rep) => (
              <div
                key={rep.id}
                {...draggableProps(rep.id)}
                className={`flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-amber-100 shadow-sm hover:shadow transition-all select-none ${
                  dropping ? "" : "cursor-grab active:cursor-grabbing"
                } ${draggingRepId === rep.id ? "opacity-20 scale-95" : ""}`}
              >
                <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 pointer-events-none" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm6 0a2 2 0 10.001 4.001A2 2 0 0013 2zM7 8a2 2 0 10.001 4.001A2 2 0 007 8zm6 0a2 2 0 10.001 4.001A2 2 0 0013 8zM7 14a2 2 0 10.001 4.001A2 2 0 007 14zm6 0a2 2 0 10.001 4.001A2 2 0 0013 14z" />
                </svg>
                <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 pointer-events-none">{rep.code}</span>
                <span className="text-sm text-gray-900 pointer-events-none">{rep.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
