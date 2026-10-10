import type en from '../en/profile';
import type { Shape } from '../shape';

const profile: Shape<typeof en> = {
  unknownBrowser: 'Неизвестный браузер',
  male: 'Мужской',
  female: 'Женский',
  gender: 'Пол',
  nameFailed: 'Не получилось сохранить имя.',
  sessionsFailed: 'Не получилось прочитать сеансы.',
  signOutFailed: 'Не получилось завершить сеанс.',
  githubFailed: 'Не получилось сохранить логин GitHub.',
  passwordFailed: 'Не получилось сменить пароль.',
  since: 'С НАМИ С {date}',
  displayName: 'Отображаемое имя',
  currentPassword: 'Текущий пароль',
  mismatch: 'Не совпадает с новым паролем.',
  passwordChanged: 'Пароль изменён.',
  changePassword: 'Сменить пароль',
  integrations: 'Интеграции',
  githubLogin: 'Логин на GitHub',
  githubHint: 'Имя из адреса github.com/имя — по нему твои коммиты будут показываться под твоим именем.',
  notLinked: 'Не привязан',
  unlink: 'Отвязать',
  link: 'Привязать',
  sessions: 'Сеансы',
  signedIn: 'ВХОД {date}',
  active: 'АКТИВНОСТЬ {date}',
  thisDevice: 'Это устройство',
  signOutOthers: 'Завершить другие сеансы',
  endSession: 'Завершить',
};

export default profile;
