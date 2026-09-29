update states
   set color = '#e0917f'
 where color = '#d9b95c' and lower(btrim(name)) = 'backlog';
