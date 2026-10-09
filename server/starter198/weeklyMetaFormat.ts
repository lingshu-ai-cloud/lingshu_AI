import type {SocialOwnedVideoMetadata,SocialWeeklyG6Check} from '../../shared/contracts/socialWeeklyG6Review.js';
import {socialRequestHash} from './socialContentValidation.js';
const instagramSource='https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md';
const instagramCollection='https://www.postman.com/meta/instagram/folder/y6xustx/reels-publishing';
const facebookReference='https://developers.facebook.com/docs/graph-api/reference/page/videos/';
/** Verified 2026-10-10 against Meta's official sample + Postman. This is partial
 * validation for the actual REELS/video_url endpoint, never full eligibility.
 * Direct current API reference returned HTTP429. File-size/current-version
 * eligibility remains unknown; do not use the sample's 1GB as a pass guarantee.
 * Facebook sends /page/videos, so Facebook Reels requirements do not apply.
 * Present exact-byte input descriptors can reject known bitrate, audio
 * sampling/channels and scan/chroma violations; absent fields stay unknown.
 * They do not prove closed GOP, MP4 atoms/edit lists or the submitted publish
 * derivative, nor does an audio header imply complete audio-track decoding. */
export function checkWeeklyMetaFormat(platform:'instagram'|'facebook',metadata:SocialOwnedVideoMetadata|null,delivery?:{deliveryProofHash:string}):SocialWeeklyG6Check{
 const result=(status:SocialWeeklyG6Check['status'],reasons:string[]):SocialWeeklyG6Check=>({code:'platform_format',status,reasons,evidenceRefs:[...(platform==='instagram'?[instagramSource,instagramCollection]:[facebookReference]),'meta_format_partial_rules:2026-10-10',...(metadata?[`owned_metadata:${metadata.recordHash}`]:[]),...(delivery&&/^[a-f0-9]{64}$/.test(delivery.deliveryProofHash)?[`archived_instagram_delivery:${delivery.deliveryProofHash}`]:[])]});
 if(!metadata)return result('unknown',['owned_media_metadata_unavailable']);
 const {recordHash,...body}=metadata;
 if(recordHash!==socialRequestHash(body)||!/^[a-f0-9]{64}$/.test(metadata.fileSha256)||metadata.probeTool!=='ffmpeg_owned_byte_decode'||!metadata.probeVersion||!Number.isSafeInteger(metadata.bytes)||metadata.bytes<=0||![metadata.width,metadata.height].every(x=>Number.isSafeInteger(x)&&x>0)||![metadata.framesPerSecond,metadata.durationSeconds].every(x=>Number.isFinite(x)&&x>0))return result('unknown',['owned_media_metadata_integrity_unverified']);
 if(platform==='facebook')return result('unknown',['facebook_page_videos_current_format_rules_unverified']);
 const reasons:string[]=[];
 if(!metadata.container||!['mp4','mov'].includes(metadata.container))reasons.push('instagram_reels_container_not_supported');
 if(!['h264','hevc'].includes(metadata.videoCodec))reasons.push('instagram_reels_video_codec_not_supported');
 if(metadata.audioCodec!==null&&metadata.audioCodec!=='aac')reasons.push('instagram_reels_audio_codec_not_supported');
 if(metadata.framesPerSecond<23||metadata.framesPerSecond>60)reasons.push('instagram_reels_framerate_outside_rule');
 if(metadata.width>1920)reasons.push('instagram_reels_width_exceeds_rule');
 if(metadata.width/metadata.height<0.01||metadata.width/metadata.height>10)reasons.push('instagram_reels_aspect_ratio_outside_rule');
 if(metadata.durationSeconds<3||metadata.durationSeconds>900)reasons.push('instagram_reels_duration_outside_rule');
 if(metadata.videoBitrateBitsPerSecond!=null&&metadata.videoBitrateBitsPerSecond>25_000_000)reasons.push('instagram_reels_video_bitrate_exceeds_rule');
 if(metadata.audioSampleRateHz!=null&&metadata.audioSampleRateHz>48_000)reasons.push('instagram_reels_audio_sample_rate_exceeds_rule');
 if(metadata.audioChannels!=null&&![1,2].includes(metadata.audioChannels))reasons.push('instagram_reels_audio_channels_not_supported');
 if(metadata.videoScanMode==='interlaced')reasons.push('instagram_reels_video_scan_not_progressive');
 if(metadata.videoPixelFormat!=null&&/^yuvj?(422|444|411|410)/.test(metadata.videoPixelFormat))reasons.push('instagram_reels_chroma_not_supported');
 if(reasons.length)return result('blocked',reasons);
 return result('unknown',['instagram_reels_current_file_limit_unverified','instagram_reels_stream_structure_unverified',...(!delivery||!/^[a-f0-9]{64}$/.test(delivery.deliveryProofHash)?['instagram_publish_derivative_source_unverified']:[])]);
}
