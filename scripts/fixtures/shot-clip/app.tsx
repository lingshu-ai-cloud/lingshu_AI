import React from 'react';
import { createRoot } from 'react-dom/client';
import BenchmarkAnalysisSections from '../../../src/components/inspiration/BenchmarkAnalysisSections';
import { AuthenticatedVideo } from '../../../src/components/inspiration/InspirationMedia';
const shot = (index: number) => ({shotId: String(index),index,time:'0–1s',materialType:'other',narrativeRole:'unknown',visual:'测试切片',clipRef:'/demo/mock-0627.mp4'});
createRoot(document.getElementById('root')!).render(<BenchmarkAnalysisSections analysis={{shots:[shot(1),shot(2),shot(3)],speechGroups:[],totalShots:3,timelineComplete:true,materialCounts:{},structure:[]} as any} mode="shots" renderClip={url=><AuthenticatedVideo apiUrl={url} controls className="clip"/>}/>);
