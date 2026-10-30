import { computed, defineAsyncComponent, ref } from 'vue';
import { api } from './api';
import { useBoards, type BoardFull } from './boards';
import type { Issue, IssueTag } from './issues';
import { useProjects } from './projects';

const load = () => import('../components/IssueView.vue');

export const IssueView = defineAsyncComponent(load);

export const preloadIssueView = (): void => void load();

export interface OpenIssue {
  key: string;
  project: string;
  board: BoardFull;
  comment?: string;
}

export function useIssueOverlay() {
  const { projects } = useProjects();
  const { boardOf, forget } = useBoards();
  const open = ref<OpenIssue | null>(null);
  const tags = ref<IssueTag[]>([]);
  const boardsOf = (project: string | undefined) =>
    projects.value.find((p) => p.shortName === project)?.boards ?? [];

  return {
    open,
    tags,
    boards: computed(() => boardsOf(open.value?.project)),
    boardAt(project: string, slug: string) {
      return boardsOf(project).find((b) => b.slug === slug);
    },
    async withTags(boardId: string): Promise<{ board: BoardFull; tags: IssueTag[] }> {
      const [board, all] = await Promise.all([api<BoardFull>(`/boards/${boardId}`), api<IssueTag[]>('/tags')]);
      return { board, tags: all.filter((t) => board.tagIds.includes(t.id)) };
    },
    async byKey(key: string, known?: { boardId: string; project: string }): Promise<OpenIssue> {
      let boardId = known?.boardId;
      let project = known?.project;
      if (!boardId) {
        const got = await api<Issue>(`/issues/${encodeURIComponent(key)}`);
        boardId = got.boardId;
        project = projects.value.find((p) => p.id === got.projectId)?.shortName;
      }
      forget(boardId);
      return { key, project: project ?? '', board: await boardOf(boardId) };
    },
  };
}
