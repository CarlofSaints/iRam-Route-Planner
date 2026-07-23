import { SessionPayload } from "./types";
import { getReps, getTeams, getUsers } from "./data";

export interface ManagerInfo {
  name: string;
  email: string;
  cell: string;
  title: string;
}

export async function resolveManager(
  session: SessionPayload
): Promise<ManagerInfo | null> {
  if (session.role === "rep") {
    // Rep → their team manager
    const reps = await getReps();
    const rep = reps.find(
      (r) => r.email.toLowerCase() === session.email.toLowerCase()
    );
    if (!rep?.teamId) return null;
    const teams = await getTeams();
    const team = teams.find((t) => t.id === rep.teamId);
    if (!team) return null;
    return {
      name: team.managerName,
      email: team.managerEmail,
      cell: team.managerCell,
      title: "Team Manager",
    };
  }

  if (session.role === "teamManager") {
    // Team manager → the superAdmin user (National Manager)
    const users = await getUsers();
    const superAdmin = users.find((u) => u.role === "superAdmin");
    if (!superAdmin) return null;
    return {
      name: superAdmin.name,
      email: superAdmin.email,
      cell: superAdmin.cell || "",
      title: "National Manager",
    };
  }

  // Admin / SuperAdmin / Viewer → no manager
  return null;
}
