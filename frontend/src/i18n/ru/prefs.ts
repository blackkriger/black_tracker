import type en from '../en/prefs';
import type { Shape } from '../shape';

const prefs: Shape<typeof en> = {
  topBar: 'Верхняя панель',
  sidebar: 'Боковая панель',
  dark: 'Тёмная',
  light: 'Светлая',
  system: 'Как в системе',
  starCreated: 'Созданные мной',
  starAssigned: 'Назначенные мне',
  starCommented: 'С моими комментариями',
  layout: 'Раскладка',
  theme: 'Тема',
  commentsRead: 'Порядок комментариев',
  oldestFirst: 'Сначала старые',
  newestFirst: 'Сначала новые',
  noticesShown: 'Показывать уведомления',
  files: 'Файлы',
  wrapLines: 'Переносить длинные строки',
  starAuto: 'Добавлять в избранное',
  language: 'Язык',
};

export default prefs;
