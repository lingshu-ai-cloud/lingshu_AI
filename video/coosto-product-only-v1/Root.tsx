import React from 'react';
import {AbsoluteFill, CanvasImage, Composition, Easing, interpolate, Series, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

type SceneProps = {readonly caption: string; readonly accent: string; readonly index: number};

const ProductScene: React.FC<SceneProps> = ({caption, accent, index}) => {
  const frame=useCurrentFrame();
  const {fps,durationInFrames}=useVideoConfig();
  const enter=interpolate(frame,[0,.45*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.16,1,.3,1)});
  const progress=interpolate(frame,[0,Math.max(1,durationInFrames-1)],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:`linear-gradient(155deg,#071827 0%,${accent} 58%,#f6d9dc 140%)`,fontFamily:'Helvetica, Arial, sans-serif',overflow:'hidden'}}>
    <div style={{position:'absolute',inset:-120,opacity:.22,background:'radial-gradient(circle at 22% 18%,#fff 0 2px,transparent 3px)',backgroundSize:'38px 38px',translate:`${-20+progress*40}px ${-12+progress*24}px`}} />
    <div style={{position:'absolute',top:92,left:72,right:72,display:'flex',justifyContent:'space-between',alignItems:'center',opacity:enter}}>
      <div style={{fontSize:34,fontWeight:800,letterSpacing:5,color:'#fff'}}>COOSTO</div>
      <div style={{fontSize:25,fontWeight:700,color:'#fff',padding:'12px 20px',border:'2px solid rgba(255,255,255,.5)',borderRadius:999}}>GUIANFA PACKAGING</div>
    </div>
    <div style={{position:'absolute',top:245,left:74,right:74,height:930,borderRadius:54,background:'rgba(255,255,255,.96)',boxShadow:'0 42px 110px rgba(0,0,0,.28)',overflow:'hidden',opacity:enter,scale:interpolate(frame,[0,.7*fps,durationInFrames-1],[.94,1,1.045],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.16,1,.3,1)})}}>
      <CanvasImage src={staticFile('coosto-gui-anfa-packaging.png')} premountFor={fps} style={{width:'100%',height:'100%',objectFit:'contain',padding:54,boxSizing:'border-box',translate:index%2===0?`${-10+progress*20}px 0`:`${10-progress*20}px 0`}} />
    </div>
    <div style={{position:'absolute',left:72,right:72,bottom:150,minHeight:330,borderRadius:48,background:'rgba(4,15,27,.9)',border:'1px solid rgba(255,255,255,.18)',padding:'54px 52px',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'center',opacity:enter,translate:`0 ${interpolate(frame,[0,.5*fps],[44,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.16,1,.3,1)})}px`}}>
      <div style={{fontSize:25,fontWeight:800,letterSpacing:3,color:'#8fd8ff',marginBottom:22}}>PRODUCT FACT · {String(index+1).padStart(2,'0')}</div>
      <div style={{fontSize:55,lineHeight:1.12,fontWeight:800,color:'#fff',letterSpacing:-1.3}}>{caption}</div>
    </div>
    <div style={{position:'absolute',left:72,right:72,bottom:86,height:6,borderRadius:6,background:'rgba(255,255,255,.18)'}}><div style={{height:'100%',width:`${progress*100}%`,background:'#8fd8ff',borderRadius:6}} /></div>
  </AbsoluteFill>;
};

const CoostoProductOnly: React.FC = () => {
  const {fps}=useVideoConfig();
  return <Series>
    <Series.Sequence name="Hook" durationInFrames={67} premountFor={fps}><ProductScene index={0} accent="#0b5f8a" caption="Meet COOSTO antiperspirant and deodorant spray." /></Series.Sequence>
    <Series.Sequence name="Packaging" durationInFrames={311} premountFor={fps}><ProductScene index={1} accent="#7c466d" caption="The confirmed packaging reference shows Marine Cool and Rose Musk." /></Series.Sequence>
    <Series.Sequence name="Format" durationInFrames={90} premountFor={fps}><ProductScene index={2} accent="#14678c" caption="A compact 30 ml spray format." /></Series.Sequence>
    <Series.Sequence name="Options" durationInFrames={300} premountFor={fps}><ProductScene index={3} accent="#814e74" caption="The product listing identifies eight fragrance options." /></Series.Sequence>
    <Series.Sequence name="Comparison" durationInFrames={45} premountFor={fps}><ProductScene index={4} accent="#125f87" caption="Both packages stay visible for an easy side-by-side view." /></Series.Sequence>
    <Series.Sequence name="Identity" durationInFrames={399} premountFor={fps}><ProductScene index={5} accent="#75456d" caption="Packaging identity stays locked to the supplied product image." /></Series.Sequence>
    <Series.Sequence name="CTA" durationInFrames={375} premountFor={fps}><ProductScene index={6} accent="#0d607f" caption="Contact us on WhatsApp for product details." /></Series.Sequence>
  </Series>;
};

export const RemotionRoot: React.FC = () => <Composition id="CoostoProductOnlyV1" component={CoostoProductOnly} durationInFrames={1587} fps={30} width={1080} height={1920} />;
