import { expect, test } from 'vitest';
import { useStudio } from './store';
import { newProject, node } from './model';

test('deleting a selected group publishes project and valid selection atomically', () => {
  const project = newProject(false);
  const group = node('group');
  const child = node('box', { parent: group.id });
  project.nodes.push(group, child);
  useStudio.getState().replace(project);
  useStudio.setState({ selected: [group.id, child.id] });
  const invalidSelections: string[][] = [];
  const unsubscribe = useStudio.subscribe((state) => {
    const invalid = state.selected.filter((id) => !state.project.nodes.some((n) => n.id === id));
    if (invalid.length) invalidSelections.push(invalid);
  });
  try {
    useStudio.getState().remove();
    expect(invalidSelections).toEqual([]);
    expect(useStudio.getState().selected).toEqual([]);
    expect(useStudio.getState().project.nodes.some((n) => n.id === child.id)).toBe(false);
    useStudio.getState().undo();
    expect(useStudio.getState().project.nodes.some((n) => n.id === child.id)).toBe(true);
    useStudio.getState().redo();
    expect(useStudio.getState().project.nodes.some((n) => n.id === child.id)).toBe(false);
  } finally {
    unsubscribe();
  }
});
