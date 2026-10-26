delete from feedback_forms f
 where f.id = 'demo'
   and not exists (select 1 from feedback_responses r where r.form_id = f.id)
   and not exists (select 1 from feedback_sessions s where s.form_id = f.id);
