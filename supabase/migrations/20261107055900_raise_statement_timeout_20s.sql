-- GM decision 7/11
ALTER ROLE authenticated SET statement_timeout = '20s';
ALTER ROLE authenticator SET statement_timeout = '20s';
NOTIFY pgrst, 'reload config';
