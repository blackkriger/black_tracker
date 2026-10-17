import type en from '../en/builds';
import type { Shape } from '../shape';

const builds: Shape<typeof en> = {
  title: 'Билды',
  upload: 'Загрузить',
  uploading: 'Загрузка {percent}%',
  driveLink: 'Ссылка на Google Диск',
  add: 'Добавить',
  none: 'Билдов пока нет.',
  tooLarge: 'Билд не больше 1 ГБ.',
  uploadFailed: 'Не получилось загрузить билд.',
  notDriveLink: 'Это не ссылка на Google Диск.',
  driveClosed: 'Открой файл всем, у кого есть ссылка, и попробуй снова.',
  addFailed: 'Не получилось добавить ссылку.',
};

export default builds;
