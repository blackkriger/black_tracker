import type en from '../en/settings';
import type { Shape } from '../shape';

const settings: Shape<typeof en> = {
  sections: 'Разделы настроек',
  profile: 'Профиль',
  preferences: 'Предпочтения',
  archivedMark: '(в архиве)',
  newProjectLink: 'Новый проект…',
  workspace: 'Рабочее пространство',
  usersAccess: 'Пользователи и доступ',
  updated: 'ОБНОВЛЕНО {date}',
  newProject: 'Новый проект',
  key: 'Ключ',
  keyHint: 'Заглавные латинские буквы и цифры.',
  name: 'Название',
  createProject: 'Создать проект',
  createProjectFailed: 'Не получилось создать проект.',
};

export default settings;
