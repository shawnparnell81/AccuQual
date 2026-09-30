import type { TemplateStamp } from "./templateStructure.js";

/**
 * Recorded master-form revisions. Fill/save does not change these.
 * When a layout, section, field, or formula changes, the catalog test fails
 * until version, revision, and structureHash are updated together
 * (see bumpRevision).
 */
export const FORM_TEMPLATE_CATALOG: Record<string, TemplateStamp> = {
  "form:appearance_approval": {
    "version": 2,
    "revision": "B",
    "structureHash": "57d8cbea5aba75dad745891a275dff067ef03a108da04532d39f91dcb7de6f0c"
  },
  "form:approved_vendor_list": {
    "version": 1,
    "revision": "A",
    "structureHash": "6ad6991a10ffe9dc1090a320114e299235289082bcbe19d189ba1b2ffe0b21cb"
  },
  "form:apqp_summary": {
    "version": 1,
    "revision": "A",
    "structureHash": "582ff7b3174870669f4b6dd597e8da51d6c6e9cc471caf3fdf39244ffdd047e0"
  },
  "form:audit_checklist": {
    "version": 1,
    "revision": "A",
    "structureHash": "3fc8bb1079476eb5b97654eb048a3ffbb84596c775e4227886e605307c6e0d97"
  },
  "form:audit_plan": {
    "version": 1,
    "revision": "A",
    "structureHash": "cb1e8308f942226e1aeba9b55495ae9548a44540010c6fc90e546e0669c474ed"
  },
  "form:calibration": {
    "version": 1,
    "revision": "A",
    "structureHash": "208af2a64b67a499c2dcb539f401ee24bb4fd8eab45d154ba1a9217795cedd6d"
  },
  "form:capa": {
    "version": 2,
    "revision": "B",
    "structureHash": "07546853c1cbca18a81878ff4a4f2691d0afb44c4058c8bcc4a20c1f13a9c3c2"
  },
  "form:change": {
    "version": 1,
    "revision": "A",
    "structureHash": "f2bd85aec752ea25116a3f50bdf809646053dae76d92fb852c9cde8630789c1b"
  },
  "form:competency_matrix": {
    "version": 1,
    "revision": "A",
    "structureHash": "4cf1f87a3ab212e393e0c488fd14c56052305b1b6a45e4107ba574e1d3a1beec"
  },
  "form:complaint": {
    "version": 1,
    "revision": "A",
    "structureHash": "f9ba8f4f6fef14df4a00eebfe09e5bb39c738cd865e8497d776db1dd075b2de8"
  },
  "form:context_of_organization": {
    "version": 1,
    "revision": "A",
    "structureHash": "097fba4313bc79860c3d4e5b623de1c548ad767018e1f040b0791f859b164cc2"
  },
  "form:control_plan": {
    "version": 1,
    "revision": "A",
    "structureHash": "2448c54f8ba95b6fea10237ada59c10c2caea39ecd5dfe0c7b338435ffb948c7"
  },
  "form:daily_production_log": {
    "version": 1,
    "revision": "A",
    "structureHash": "ed172d56716ed2596d2d0b019e854eec45c7ffd0ce738ff5e6f5c702dbb260a9"
  },
  "form:dimensional_report": {
    "version": 2,
    "revision": "B",
    "structureHash": "97cbe9536c43ee050cc93655c367967a09c0a288b1eb12a21549261d5203dfa1"
  },
  "form:discrepancy_inspection": {
    "version": 1,
    "revision": "A",
    "structureHash": "705a2254b5cf386c0bf3b3776ee41b913cf76046cf5f52fbeffb86af90aefaf6"
  },
  "form:document_control_index": {
    "version": 1,
    "revision": "A",
    "structureHash": "12945fc8b0d9bfd1af8fe6fad8ca16b85b072146f18c31be2d1bd5af3ad05765"
  },
  "form:dvpr": {
    "version": 2,
    "revision": "B",
    "structureHash": "304fa341983a90a8da7e9d2dd11e46cde8c90d5836c774f8f92f165def84e6cd"
  },
  "form:eight_d": {
    "version": 1,
    "revision": "A",
    "structureHash": "a210f537b0d0e876459b34c027ba9b3cdcdebac54a41443a8319e800ba55c348"
  },
  "form:final_inspection_release_checklist": {
    "version": 2,
    "revision": "B",
    "structureHash": "7c7d522d4e234d82b4d544d168c2348eb8cecb27e330bd6c8d55db0ba09fbfe8"
  },
  "form:five_why": {
    "version": 1,
    "revision": "A",
    "structureHash": "4c99c50dfac5b36048141663d5a477b8064fe74c74a130539100a31e9b899488"
  },
  "form:fmea": {
    "version": 1,
    "revision": "A",
    "structureHash": "3f5c7f58ae66b9303d92cc7d1e4d640fff3a279934724b32fdc0c20713fb2975"
  },
  "form:gage_rr": {
    "version": 2,
    "revision": "B",
    "structureHash": "426aaccc7ee07a0471af3f81461fa1144385365f042fc79d8efd2ee256067cbf"
  },
  "form:inventory_item": {
    "version": 1,
    "revision": "A",
    "structureHash": "19092267ddaba3db623e9362c6920d3bfd0fa4575ad75c254a7eb192c7fe127d"
  },
  "form:lpa": {
    "version": 1,
    "revision": "A",
    "structureHash": "2855bd4b9b9c9487c3b88a04175b11ab9b77e72af28725a79bfac7612f0a12d6"
  },
  "form:maintenance_work_order": {
    "version": 1,
    "revision": "A",
    "structureHash": "7da6b4fc4a2f9bbb986eec8ddb09c934b072b5c669e857035ffb163208a39006"
  },
  "form:management_review": {
    "version": 1,
    "revision": "A",
    "structureHash": "e8b020931ff2dc91f492f733d4e1bae2bc350af03ef0cad90b2c67e3a92a05f3"
  },
  "form:management_review_minutes": {
    "version": 1,
    "revision": "A",
    "structureHash": "22cb570f2a97af305e2baadbde035006fa68f132b36a1b5750c3d07f42ba6eec"
  },
  "form:ncr": {
    "version": 2,
    "revision": "B",
    "structureHash": "b300a5f1ec45f83f6b33faba3f15b9a4d1222b8e4a7504f05827d804e856255b"
  },
  "form:pareto_chart": {
    "version": 1,
    "revision": "A",
    "structureHash": "45e732fe5de3dd5687f28bacebce4e690bdc59c173f2e1b539981d1d540adf83"
  },
  "form:pcn": {
    "version": 2,
    "revision": "B",
    "structureHash": "fcdc735226e737346eacbb2d9ac85327777f0c9125d6ea4c530d600873fd861c"
  },
  "form:process_flow_diagram": {
    "version": 1,
    "revision": "A",
    "structureHash": "c5c8e683cd8e33924683301da901965f8bddc8943fdce97e9c12aaa5d0d2e6b0"
  },
  "form:production_log": {
    "version": 1,
    "revision": "A",
    "structureHash": "5b9e057aa556d011b6660847e1c8a17c8b88457d501971ac5a3e6b4d32689b85"
  },
  "form:production_output_log": {
    "version": 1,
    "revision": "A",
    "structureHash": "40ec4f10a73403c0be761ebf1d79d0c636a8be8249471ba76f1d620270d4e5eb"
  },
  "form:staff_meeting_minutes": {
    "version": 1,
    "revision": "A",
    "structureHash": "823581049affc475c8569f426fe0053bc7a178001475543ff26e37a8dc583d83"
  },
  "form:supplier": {
    "version": 1,
    "revision": "A",
    "structureHash": "c896d558433d169c823e3b02431ef37227cafab9a00e831f1d53fbc034ad0d7d"
  },
  "form:training": {
    "version": 1,
    "revision": "A",
    "structureHash": "4e2947103a6c845cf025524cf0f74f97c96b3399e6634e68c2175a3d60346a31"
  },
  "qms:document_revision_record": {
    "version": 1,
    "revision": "A",
    "structureHash": "8456c01a2d13ec41cb56f289822149bff0288bdba447181102e1c567707d2a96"
  },
  "qms:master_document_register": {
    "version": 1,
    "revision": "A",
    "structureHash": "50a4030b5433e804003d1d0a4fa01437be02a3da092d1bd07ce389a47b9abdea"
  },
  "qms:record_retention_log": {
    "version": 1,
    "revision": "A",
    "structureHash": "9375be4e3587460d7c28f81a4e2b4c996f4728f532eb9b960f56f289af4b9eb9"
  },
  "qms:quality_objectives_action_plan": {
    "version": 1,
    "revision": "A",
    "structureHash": "5facf8b4be42e55b742e62ada03a678a68ba7902f5c59b485370667801ad181a"
  },
  "qms:preventive_risk_action": {
    "version": 1,
    "revision": "A",
    "structureHash": "8604346edc8227eaab6e7a55881c476cbd4d302a52d80cf183394bfa8bd33899"
  },
  "qms:supplier_qualification_evaluation": {
    "version": 1,
    "revision": "A",
    "structureHash": "98d3c1ddfaecc7fac15c90727171543210073fcaa070ae2cacba0c211154d413"
  },
  "qms:po_quality_requirements": {
    "version": 1,
    "revision": "A",
    "structureHash": "f017b0703fef8fcfdc0fe7e502fdd12bac3de59ea9f9c6b54834b4daf586054d"
  },
  "qms:incoming_inspection_record": {
    "version": 1,
    "revision": "A",
    "structureHash": "cf4cfaa00ca72bad0b209699fc4b0174821b03a2ef3ac2eb371ebd10014eeaec"
  },
  "qms:first_article_inspection": {
    "version": 1,
    "revision": "A",
    "structureHash": "cd05a0fd1f739ac5a8bb4c1bae7613231c2f81487ec60f4022f39fe2e4b6e6e7"
  },
  "qms:in_process_inspection": {
    "version": 1,
    "revision": "A",
    "structureHash": "b7398acebcf78ac0a0e27bca20733d29822bae150397bbb55bc66d3e79d014c1"
  },
  "qms:final_inspection_release": {
    "version": 1,
    "revision": "A",
    "structureHash": "a741fd064e7ae1acc8bd1e8305e90d5032c54a91269f6eb06babb1f5d728acd8"
  },
  "qms:training_matrix": {
    "version": 1,
    "revision": "A",
    "structureHash": "0e4f948e05042a79de0819f84701d50b1541dcc5de90c68b458ce5b0ea2eebde"
  },
  "qms:customer_satisfaction_record": {
    "version": 1,
    "revision": "A",
    "structureHash": "d093352d815def1b65da41b96894c5a3936015b55c27e439009fb23258541645"
  },
  "qms:product_traceability_record": {
    "version": 1,
    "revision": "A",
    "structureHash": "3016ad4a16daee20de11c0c74752c64c06005bee97eb76213e115c62639a5ce1"
  },
  "qms:deviation_waiver_request": {
    "version": 1,
    "revision": "A",
    "structureHash": "387661be93f57fe665dc185e0d3f77ce9e3cc0235bfd22e9a9705869057762ca"
  },
  "qms:change_control_record": {
    "version": 1,
    "revision": "A",
    "structureHash": "48a1828dee3d8f4418b3e1ac182a3eab6acb9b8003c3700406af4e9ceb7452df"
  },
  "qms:management_review_record": {
    "version": 1,
    "revision": "A",
    "structureHash": "8e72e002d17617035c3ea914153003cba1f2d90f9823ca06d96c0400db7b54d9"
  },
  "qms:quality_kpi_monitoring": {
    "version": 1,
    "revision": "A",
    "structureHash": "271b8b3970d7558034241c05f8da5da041ec9bc7105c00734b909bd4b4ea7fc6"
  },
  "qms:environmental_condition_record": {
    "version": 1,
    "revision": "A",
    "structureHash": "6ddd5b15dbc75b2332958fa8261a7da7356b431775bca0d9f28810b8906f48bf"
  },
  "qms:audit_finding_action_log": {
    "version": 1,
    "revision": "A",
    "structureHash": "4a0d047f0049c6a37e25ba900154b370302fab74d44e90e047f7b1717ca85c23"
  },
  "qms:quality_record_disposition": {
    "version": 1,
    "revision": "A",
    "structureHash": "19b9e0a5354068d1c1698bb253a68701313502382d9a9b6e3d7a805479ccc367"
  },
  "qms:design_history_form": {
    "version": 1,
    "revision": "A",
    "structureHash": "76aeba98cf43fe3c531edbee84b33a8996229d4856cda86d3ae945e42ce34b7e"
  },
  "dcr": {
    "version": 1,
    "revision": "A",
    "structureHash": "d00a0ad39ba8d44f1205af9ed5d2e3e48e8b2e1232a621e94472d63c205169d9"
  },
  "feasibility": {
    "version": 1,
    "revision": "1.0",
    "structureHash": "3c598b875029c514a89b842a26766c540873f68d289bfb56a79cd81e28f494e1"
  }
};
