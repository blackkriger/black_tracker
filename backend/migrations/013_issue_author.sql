-- The person who wrote the issue is its author, which is what the interface calls them; "reporter" was the brief's word and nobody else's.

alter table issues rename column reporter_id to author_id;
