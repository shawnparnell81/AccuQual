export interface DepartmentAccessCell {
  departmentName: string;
  moduleName: string;
  accessLevel: string;
}

export interface DepartmentAccessChange {
  departmentName: string;
  moduleName: string;
  from: string;
  to: string;
}

/** Cells whose level would change. A missing current cell is None. */
export function departmentCellsThatChange(current: readonly DepartmentAccessCell[], requested: readonly DepartmentAccessCell[]): DepartmentAccessChange[] {
  const currentLevel = new Map(current.map((cell) => [`${cell.departmentName}:${cell.moduleName}`, cell.accessLevel]));
  const changes: DepartmentAccessChange[] = [];
  for (const cell of requested) {
    const from = currentLevel.get(`${cell.departmentName}:${cell.moduleName}`) ?? "none";
    if (from === cell.accessLevel) continue;
    changes.push({ departmentName: cell.departmentName, moduleName: cell.moduleName, from, to: cell.accessLevel });
  }
  return changes;
}
