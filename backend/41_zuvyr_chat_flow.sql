-- ZUVYR Chat Flow 07. Run the WHOLE file once in the intended Supabase SQL Editor.
-- One DO statement: all definitions and checks commit or fail together.
-- No existing functions replaced, balances granted, plan limits or runtime flags changed.
DO $install$
DECLARE x record; actual text;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  IF to_regclass('public.zuvyr_chat_flows') IS NOT NULL THEN
    RAISE EXCEPTION 'chat_flow_already_installed_do_not_rerun';
  END IF;
  FOR x IN SELECT * FROM (VALUES
    ('reserve_zuvyr_usage','75d0ac7b1e205a6b250584e0817e77f0'),
    ('settle_zuvyr_usage','100704c3ed6c4434f4ccbf37b263801a'),
    ('protect_sensitive_profile_columns','ab199d3953b072ade3facf01c09c1bfc')
  ) v(name,fingerprint) LOOP
    SELECT md5(regexp_replace(p.prosrc,'\s','','g')) INTO actual FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=x.name;
    IF actual IS DISTINCT FROM x.fingerprint THEN RAISE EXCEPTION 'wallet_prerequisite_mismatch: %', x.name; END IF;
  END LOOP;
  IF to_regclass('public.shared_conversations') IS NULL OR to_regclass('public.conversation_messages') IS NULL THEN
    RAISE EXCEPTION 'durable_conversation_schema_required';
  END IF;
  CREATE SCHEMA zuvyr_chat_flow_07_backup;
  REVOKE ALL ON SCHEMA zuvyr_chat_flow_07_backup FROM PUBLIC,anon,authenticated,service_role;
  CREATE TABLE zuvyr_chat_flow_07_backup.definitions AS SELECT p.oid,pg_get_functiondef(p.oid) AS definition,p.proacl,p.proowner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('reserve_zuvyr_usage','settle_zuvyr_usage','refund_zuvyr_usage','protect_sensitive_profile_columns');
  CREATE TABLE public.zuvyr_chat_flows(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
    conversation_id uuid NOT NULL REFERENCES public.shared_conversations(id), turn_id uuid NOT NULL,
    payload_hash text NOT NULL CHECK(length(payload_hash)=64),quote jsonb NOT NULL,
    state text NOT NULL DEFAULT 'quoted' CHECK(state IN('quoted','running','result_ready','refund_ready','complete','refunded','cancelled')),
    allow_topup boolean, funding_source text, result jsonb, provider_result jsonb, cancel_requested boolean NOT NULL DEFAULT false, history_saved boolean NOT NULL DEFAULT false,
    message_count integer,created_at timestamptz NOT NULL DEFAULT clock_timestamp(), started_at timestamptz,
    finished_at timestamptz, UNIQUE(user_id,turn_id)
  );
  CREATE UNIQUE INDEX zuvyr_chat_one_pending_conversation ON public.zuvyr_chat_flows(conversation_id)
    WHERE state IN('running','result_ready','refund_ready') OR (state='complete' AND NOT history_saved);
  ALTER TABLE public.zuvyr_chat_flows ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.zuvyr_chat_flows FROM PUBLIC,anon,authenticated;
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.zuvyr_chat_flows TO service_role;

  EXECUTE $ddl$
  CREATE FUNCTION public.zuvyr_chat_create_quote(p_user_id uuid,p_conversation_id uuid,p_turn_id uuid,p_payload_hash text,p_quote jsonb)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  DECLARE r public.zuvyr_chat_flows%rowtype;
  BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.shared_conversations WHERE id=p_conversation_id AND owner_id=p_user_id AND feature='chat') THEN
      RETURN jsonb_build_object('success',false,'error','conversation_not_found');
    END IF;
    PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
    SELECT * INTO r FROM public.zuvyr_chat_flows WHERE user_id=p_user_id AND turn_id=p_turn_id;
    IF FOUND THEN
      IF r.payload_hash<>p_payload_hash OR r.conversation_id<>p_conversation_id THEN RETURN jsonb_build_object('success',false,'error','turn_id_conflict'); END IF;
      RETURN jsonb_build_object('success',true,'run',to_jsonb(r));
    END IF;
    IF (p_quote->>'version') IS DISTINCT FROM 'chat-flow-07.v1' OR (p_quote->>'maxCredits')::integer NOT BETWEEN 1 AND 100000
      OR (p_quote->>'providerBound')::numeric < 0 OR (p_quote->>'expiresAt')::timestamptz <= clock_timestamp()
      OR jsonb_typeof(p_quote->'messages') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_quote'; END IF;
    IF (SELECT count(*) FROM public.zuvyr_chat_flows WHERE user_id=p_user_id AND created_at>clock_timestamp()-interval '1 hour')>=200 THEN
      RETURN jsonb_build_object('success',false,'error','quote_rate_limit'); END IF;
    INSERT INTO public.zuvyr_chat_flows(user_id,conversation_id,turn_id,payload_hash,quote) VALUES(p_user_id,p_conversation_id,p_turn_id,p_payload_hash,p_quote) RETURNING * INTO r;
    RETURN jsonb_build_object('success',true,'run',to_jsonb(r));
  END $fn$;
  $ddl$;

  EXECUTE $ddl$
  CREATE FUNCTION public.zuvyr_chat_claim(p_user_id uuid,p_id uuid,p_allow_topup boolean)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  DECLARE r public.zuvyr_chat_flows%rowtype; wallet jsonb; revision integer;
  BEGIN
    -- All mutations lock profile before flow before wallet, including retries.
    PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
    SELECT * INTO r FROM public.zuvyr_chat_flows WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','chat_run_not_found'); END IF;
    IF r.state<>'quoted' THEN RETURN jsonb_build_object('success',true,'claimed',false); END IF;
    IF (r.quote->>'expiresAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('success',false,'error','quote_expired'); END IF;
    SELECT message_count INTO revision FROM public.shared_conversations WHERE id=r.conversation_id AND owner_id=p_user_id FOR UPDATE;
    IF NOT FOUND OR revision IS DISTINCT FROM (r.quote->>'messageCount')::integer THEN RETURN jsonb_build_object('success',false,'error','conversation_changed_request_new_quote'); END IF;
    IF EXISTS(SELECT 1 FROM public.zuvyr_chat_flows WHERE conversation_id=r.conversation_id AND (state IN('running','result_ready','refund_ready') OR(state='complete' AND NOT history_saved))) THEN
      RETURN jsonb_build_object('success',false,'error','conversation_has_pending_run'); END IF;
    wallet:=public.reserve_zuvyr_usage(p_user_id,'chat07:'||p_id,'chat07:'||p_id,'chat','groq',r.quote->>'model',r.quote->>'pricingVersion',(r.quote->>'maxCredits')::integer,(r.quote->>'providerBound')::numeric,p_allow_topup,true);
    IF NOT coalesce((wallet->>'success')::boolean,false) THEN RETURN wallet; END IF;
    IF coalesce((wallet->>'replayed')::boolean,false) THEN RAISE EXCEPTION 'unexpected_existing_chat_reservation'; END IF;
    UPDATE public.zuvyr_chat_flows SET state='running',allow_topup=p_allow_topup,funding_source=wallet->>'funding_source',started_at=clock_timestamp() WHERE id=p_id;
    RETURN jsonb_build_object('success',true,'claimed',true);
  END $fn$;
  $ddl$;

  EXECUTE $ddl$
  CREATE FUNCTION public.zuvyr_chat_save_result(p_user_id uuid,p_id uuid,p_result jsonb)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  DECLARE r public.zuvyr_chat_flows%rowtype;
  BEGIN
    PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
    SELECT * INTO r FROM public.zuvyr_chat_flows WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','chat_run_not_found'); END IF;
    IF r.provider_result IS NOT NULL THEN
      IF r.provider_result IS DISTINCT FROM p_result THEN RETURN jsonb_build_object('success',false,'error','result_conflict'); END IF;
      RETURN jsonb_build_object('success',true,'replayed',true);
    END IF;
    IF r.state<>'running' THEN RETURN jsonb_build_object('success',false,'error','chat_not_running'); END IF;
    IF coalesce(p_result->>'kind','') NOT IN('success','failure') OR (p_result->>'credits')::integer NOT BETWEEN 0 AND (r.quote->>'maxCredits')::integer
      OR (p_result->>'cost')::numeric NOT BETWEEN 0 AND (r.quote->>'providerBound')::numeric
      OR ((p_result->>'kind')='failure' AND (p_result->>'credits')::integer<>0) THEN RAISE EXCEPTION 'invalid_result'; END IF;
    UPDATE public.zuvyr_chat_flows SET provider_result=p_result,
      result=CASE WHEN cancel_requested THEN p_result || jsonb_build_object('kind','failure','code','chat_cancelled_refunded','credits',0) ELSE p_result END,
      state=CASE WHEN p_result->>'kind'='success' AND NOT cancel_requested THEN 'result_ready' ELSE 'refund_ready' END WHERE id=p_id;
    RETURN jsonb_build_object('success',true);
  END $fn$;
  $ddl$;

  EXECUTE $ddl$
  CREATE FUNCTION public.zuvyr_chat_finalize(p_user_id uuid,p_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  DECLARE r public.zuvyr_chat_flows%rowtype; wallet jsonb; revenue numeric; profit numeric; margin integer;
  BEGIN
    PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
    SELECT * INTO r FROM public.zuvyr_chat_flows WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','chat_run_not_found'); END IF;
    IF r.state IN('complete','refunded') THEN RETURN jsonb_build_object('success',true,'replayed',true); END IF;
    IF r.state='running' AND r.started_at<clock_timestamp()-interval '5 minutes' THEN
      r.result:=jsonb_build_object('kind','failure','code','interrupted_run_refunded','credits',0,'cost',r.quote->>'providerBound',
        'usage',jsonb_build_object('costBasis','conservative_exposure_bound','accountInvoiceVerified',false,'allInMarginVerified',false,'providerUsageKnown',false));
      r.state:='refund_ready';
      UPDATE public.zuvyr_chat_flows SET result=r.result,state=r.state,cancel_requested=true WHERE id=p_id;
    END IF;
    IF r.state='running' THEN RETURN jsonb_build_object('success',true,'pending',true); END IF;
    IF r.state NOT IN('result_ready','refund_ready') THEN RETURN jsonb_build_object('success',false,'error','chat_result_not_ready'); END IF;
    revenue:=(r.result->>'credits')::numeric*(r.quote->'economics'->>'creditValueMicroUsd')::numeric;
    profit:=revenue-(r.result->>'cost')::numeric;
    margin:=CASE WHEN revenue>0 THEN floor(profit*10000/revenue)::integer ELSE 0 END;
    -- Legacy column names retained; metadata explicitly identifies bound-based
    -- cost and not an invoice. Financial reporting must honor costBasis.
    wallet:=public.settle_zuvyr_usage('chat07:'||p_id,(r.result->>'credits')::integer,(r.result->>'cost')::numeric,revenue,profit,margin,r.result->'usage',true);
    IF NOT coalesce((wallet->>'success')::boolean,false) THEN RETURN wallet; END IF;
    UPDATE public.zuvyr_chat_flows SET state=CASE WHEN r.state='result_ready' THEN 'complete' ELSE 'refunded' END,finished_at=clock_timestamp() WHERE id=p_id;
    RETURN jsonb_build_object('success',true);
  END $fn$;
  $ddl$;

  EXECUTE $ddl$
  CREATE FUNCTION public.zuvyr_chat_cancel(p_user_id uuid,p_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  DECLARE r public.zuvyr_chat_flows%rowtype;
  BEGIN
    PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
    SELECT * INTO r FROM public.zuvyr_chat_flows WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','chat_run_not_found'); END IF;
    IF r.state='quoted' THEN UPDATE public.zuvyr_chat_flows SET state='cancelled',finished_at=clock_timestamp() WHERE id=p_id;
    ELSIF r.state='running' THEN UPDATE public.zuvyr_chat_flows SET cancel_requested=true WHERE id=p_id;
    ELSIF r.state='result_ready' THEN UPDATE public.zuvyr_chat_flows SET cancel_requested=true,state='refund_ready',
      result=result||jsonb_build_object('kind','failure','code','chat_cancelled_refunded','credits',0) WHERE id=p_id;
    ELSIF r.state NOT IN('cancelled','refund_ready','refunded') THEN RETURN jsonb_build_object('success',false,'error','execution_already_completed'); END IF;
    RETURN jsonb_build_object('success',true);
  END $fn$;
  $ddl$;
  FOR x IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN('zuvyr_chat_create_quote','zuvyr_chat_claim','zuvyr_chat_save_result','zuvyr_chat_finalize','zuvyr_chat_cancel') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',x.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',x.signature);
  END LOOP;
  CREATE TABLE zuvyr_chat_flow_07_backup.receipt AS SELECT 'ZUVYR_CHAT_FLOW_07_SCHEMA_INSTALLED'::text AS status,clock_timestamp() AS installed_at,false AS runtime_activated;
  NOTIFY pgrst,'reload schema';
END $install$;
-- Safe report: no customer messages, balances or secrets.
SELECT 'ZUVYR_CHAT_FLOW_07_SCHEMA_INSTALLED' AS status,
  to_regclass('public.zuvyr_chat_flows') IS NOT NULL AS table_exists,
  false AS runtime_activated;
