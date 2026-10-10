import type en from '../en/auth';
import type { Shape } from '../shape';

const auth: Shape<typeof en> = {
  signIn: 'Войти',
  signingIn: 'Входим…',
  signInFailed: 'Не получилось войти.',
  login: 'Логин',
  password: 'Пароль',
  newPassword: 'Новый пароль',
  repeatPassword: 'Повтори пароль',
  repeatNewPassword: 'Повтори новый пароль',
  atLeast8: 'Не меньше 8 символов.',
  mismatch: 'Пароли не совпадают.',
  createAccount: 'Создать аккаунт',
  creating: 'Создаём…',
  createFailed: 'Не получилось создать аккаунт.',
  inviteGone: 'Эта ссылка-приглашение больше не действует.',
  linkGone: 'Эта ссылка больше не действует.',
  setPassword: 'Сохранить пароль',
};

export default auth;
