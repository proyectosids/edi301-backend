/*
  Diagnóstico de solo lectura para ejecutar mientras ocurra un bloqueo.
  Requiere VIEW SERVER STATE (o VIEW SERVER PERFORMANCE STATE en SQL Server 2022+).
*/
SELECT
  r.session_id,
  r.blocking_session_id,
  r.status,
  r.command,
  r.wait_type,
  r.wait_time,
  r.wait_resource,
  r.total_elapsed_time,
  DB_NAME(r.database_id) AS database_name,
  s.host_name,
  s.program_name,
  s.login_name,
  SUBSTRING(
    text_info.text,
    (r.statement_start_offset / 2) + 1,
    CASE
      WHEN r.statement_end_offset = -1 THEN LEN(CONVERT(NVARCHAR(MAX), text_info.text))
      ELSE ((r.statement_end_offset - r.statement_start_offset) / 2) + 1
    END
  ) AS current_statement
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) text_info
WHERE r.session_id <> @@SPID
  AND r.database_id = DB_ID()
ORDER BY
  CASE WHEN r.blocking_session_id <> 0 THEN 0 ELSE 1 END,
  r.wait_time DESC;

/* También muestra sesiones bloqueadoras aunque estén "sleeping". */
SELECT
  s.session_id,
  s.status,
  s.open_transaction_count,
  s.host_name,
  s.program_name,
  s.login_name,
  c.connect_time,
  last_sql.text AS last_statement
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) last_sql
WHERE s.session_id IN (
  SELECT DISTINCT blocking_session_id
  FROM sys.dm_exec_requests
  WHERE blocking_session_id > 0
    AND database_id = DB_ID()
);
