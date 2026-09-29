update issue_attachments
   set storage_path = substring(storage_path from '([^/]+/[^/]+)$')
 where storage_path like '/%';
