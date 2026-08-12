export type BootProgress = {
  stage: string;
  completed: number;
  total: number;
  percent: number;
};

export type BootTask = {
  stage: string;
  run: () => Promise<void>;
};

export async function runBootTasks(
  tasks: BootTask[],
  onProgress?: (progress: BootProgress) => void,
): Promise<void> {
  for (let completed = 0; completed < tasks.length; completed += 1) {
    const task = tasks[completed];
    onProgress?.({
      stage: task.stage,
      completed,
      total: tasks.length,
      percent: Math.round((completed / tasks.length) * 100),
    });
    await task.run();
  }

  onProgress?.({ stage: 'Ready', completed: tasks.length, total: tasks.length, percent: 100 });
}
