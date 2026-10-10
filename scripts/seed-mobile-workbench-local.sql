-- Local development data for the authenticated mobile workbench tenant.
-- This is persisted in PocketBase and travels through the real server routes.
BEGIN;

DELETE FROM social_sales_qualifications WHERE id LIKE 'mwseed%';
DELETE FROM social_interaction_writebacks WHERE id LIKE 'mwseed%';
DELETE FROM approval_requests WHERE id LIKE 'mwseed%';
DELETE FROM studio_shooting_tasks WHERE id LIKE 'mwseed%';
DELETE FROM workflow_tasks WHERE id LIKE 'mwseed%';
DELETE FROM posts WHERE id LIKE 'mwseed%';
DELETE FROM weekly_goals WHERE id LIKE 'mwseed%';

INSERT INTO weekly_goals (id,tenant_id,title,objective,metric,unit,baseline,target,starts_at,ends_at,status,owner_id,created_at,updated_at,version,constraints,scope)
VALUES ('mwseedgoal00001','f6939c3ae3de0c9','本周内容增长与询盘转化','完成重点内容并承接有效询盘','qualified_inquiries','条',2,8,'2026-10-05T00:00:00+08:00','2026-10-11T23:59:59+08:00','active','local-v2-test','2026-10-05T09:00:00+08:00','2026-10-10T15:30:00+08:00',1,'{}','{}');

INSERT INTO workflow_tasks (id,tenant_id,goal_id,plan_id,run_id,task_key,title,description,kind,agent_role,status,priority,blocked_reason,owner_id,sequence,depends_on,output,created_at,updated_at,task_version,automatic_execution_allowed,business_domain,business_refs,capability_key,correction_version,destination,destination_view,execution_mode,external_effect,policy_source,requires_approval,status_source)
VALUES
('mwseedtask0001','f6939c3ae3de0c9','mwseedgoal00001','','','script_final','「秋季工厂探访」脚本定稿','60 秒口播脚本与分镜已经完成','content','director','succeeded','normal','','local-v2-test',1,'[]','{"stage":"脚本完成"}','2026-10-06T09:00:00+08:00','2026-10-06T16:00:00+08:00',2,1,'content','{}','script','','smartAssets','task','automatic','none','workflow',0,'agent'),
('mwseedtask0002','f6939c3ae3de0c9','mwseedgoal00001','','','video_edit','新品功能演示成片验收','初剪和双语字幕已经生成，等待你确认成片','content','content','handed_off','urgent','请预览成片，确认通过或按问题类型退回','local-v2-test',2,'["mwseedtask0001"]','{"stage":"成片验收","dueAt":"2026-10-10T17:00:00+08:00","previewUrl":""}','2026-10-07T09:00:00+08:00','2026-10-10T14:20:00+08:00',3,0,'content','{}','content_review','','smartAssets','review','manual','publish','workflow',1,'agent'),
('mwseedtask0003','f6939c3ae3de0c9','mwseedgoal00001','','','publish_tiktok','恢复 TikTok 账号授权','授权已过期，3 条已排期内容无法发布','traffic','traffic','failed','high','TikTok @lingshu_global 授权已过期','local-v2-test',3,'[]','{"stage":"发布授权","dueAt":"2026-10-10T16:30:00+08:00","affectedCount":3}','2026-10-08T10:00:00+08:00','2026-10-10T15:00:00+08:00',2,0,'publishing','{}','account_authorization','','traffic','connections','manual','publish','workflow',0,'provider'),
('mwseedtask0004','f6939c3ae3de0c9','mwseedgoal00001','','','lead_followup','跟进 3 条高意向询盘','客服 Agent 已完成资格判断，正在生成回复草稿','conversion','customer_service','running','high','','local-v2-test',4,'[]','{"stage":"询盘跟进","dueAt":"2026-10-10T18:00:00+08:00"}','2026-10-09T11:00:00+08:00','2026-10-10T15:10:00+08:00',1,1,'conversion','{}','lead_followup','','conversion','inbox','automatic','message','workflow',0,'agent');

INSERT INTO approval_requests (id,tenant_id,goal_id,run_id,task_id,status,action_summary,risk_level,evidence,requested_by_agent,subject_version,content_hash,created_at,decided_at,decided_by,decision_note)
VALUES ('mwseedapproval1','f6939c3ae3de0c9','mwseedgoal00001','','mwseedtask0002','pending','预览新品演示成片和质检结果；通过后进入周六 18:00 发布排期，退回时需选择画面、字幕或口播问题。','high','{"qualityScore":92,"schedule":"2026-10-10T18:00:00+08:00","account":"视频号·灵枢科技"}','content',3,'seed-review-v3','2026-10-10T14:20:00+08:00','','','');

INSERT INTO studio_shooting_tasks (id,tenant_id,payload)
VALUES ('mwseedshoot0001','f6939c3ae3de0c9','{"title":"补拍产品接口特写","shotBrief":"拍摄 Type-C 接口插拔过程：竖屏、自然光、8 秒，保持商标完整入镜。上传后内容 Agent 会从素材检查节点继续。","priority":"normal","dueAt":"2026-10-11T12:00:00+08:00","createdAt":"2026-10-09T10:00:00+08:00","uploadedMaterialIds":[]}');

INSERT INTO posts (id,tenant_id,content_id,platform,platform_post_id,title,published_at,track_code,wa_link,stats,inquiries,deals)
VALUES
('mwseedpost0001','f6939c3ae3de0c9','factory-tour','视频号','wx-post-1006','工厂探访：一台设备如何完成质检','2026-10-06T12:00:00+08:00','MW1006','','{"status":"published","accountLabel":"灵枢科技","agentRole":"traffic","stage":"回执已核对"}',2,0),
('mwseedpost0002','f6939c3ae3de0c9','product-demo','抖音','','新品 30 秒功能演示','2026-10-10T18:00:00+08:00','MW1010','','{"status":"scheduled","accountLabel":"灵枢官方","agentRole":"traffic","stage":"等待成片验收"}',0,0),
('mwseedpost0003','f6939c3ae3de0c9','customer-story','小红书','','客户案例：交付周期缩短 40%','2026-10-11T11:00:00+08:00','MW1011','','{"status":"scheduled","accountLabel":"灵枢增长实验室","agentRole":"content","stage":"等待补拍素材"}',0,0);

INSERT INTO social_interaction_writebacks (id,tenant_id,event_key,kind,platform,providerEventId,accountId,contentId,body,occurredAt,actorRef,entryRef,ctaRef,businessDirectionRef,respondedAt,qualificationFields,raw,source_confidence,qualification_status,created_at,updated_at)
VALUES
('mwseedinquiry1','f6939c3ae3de0c9','seed-inquiry-1','direct_message','TikTok','seed-provider-1','@lingshu_global','factory-tour','询问 MOQ、交期及德国代理政策','2026-10-10T10:20:00+08:00','','','','','','{}','{}','high','qualified','2026-10-10T10:20:00+08:00','2026-10-10T10:30:00+08:00'),
('mwseedinquiry2','f6939c3ae3de0c9','seed-inquiry-2','direct_message','视频号','seed-provider-2','华南设备采购','product-demo','希望本周安排线上产品演示','2026-10-10T11:40:00+08:00','','','','','','{}','{}','high','qualified','2026-10-10T11:40:00+08:00','2026-10-10T11:50:00+08:00');
INSERT INTO social_sales_qualifications (id,tenant_id,interaction_id,status,authority,actor_id,reason,bant,confirmed_at)
VALUES
('mwseedqual00001','f6939c3ae3de0c9','mwseedinquiry1','qualified','sales','local-v2-test','有明确采购时间与代理政策问题','{"need":"代理采购","timeline":"本月"}','2026-10-10T10:30:00+08:00'),
('mwseedqual00002','f6939c3ae3de0c9','mwseedinquiry2','qualified','crm','local-v2-test','已确认企业采购身份并希望演示','{"need":"产品演示","timeline":"本周"}','2026-10-10T11:50:00+08:00');

COMMIT;
