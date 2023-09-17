/*
 *  Copyright (c) 2020 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
//
// A "videopipe" abstraction on top of WebRTC.
//
// The usage of this abstraction:
// var pipe = new VideoPipe(mediastream, handlerFunction);
// handlerFunction = function(mediastream) {
//   do_something
// }
// pipe.close();
//
// The VideoPipe will set up 2 PeerConnections, connect them to each
// other, and call HandlerFunction when the stream is available in the
// second PeerConnection.
//
'use strict';

// Preferring a certain codec is an expert option without GUI.
// Use VP8 by default to limit depacketization issues.
// eslint-disable-next-line prefer-const
let preferredVideoCodecMimeType = 'video/VP8';

function mungeSdp(sdp) {
  let newSdp = "";
  let ddAdded = false;
  let videoMLine = false;
  let packetizationAdded = false;
  let match;
  for (let line of sdp.split('\r\n')) {
    if (line.startsWith("m=video")) {
      videoMLine = true;
      newSdp += `${line}\r\n`;
    } else if (line.startsWith("m=audio")) {
      videoMLine = false;
      newSdp += `${line}\r\n`;
    } else if (videoMLine && /^a=extmap:\d+/.exec(line) && !ddAdded) {
      ddAdded = true;
      newSdp += `a=extmap:9 https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension
${line}
`;
    } else if (videoMLine && (match = /^a=rtpmap:(\d+) VP8\/90000/.exec(line)) && !packetizationAdded) {
      packetizationAdded = true;
      newSdp += `${line}
a=packetization:${match[1]} raw
`;
    } else if (line != '') {
      newSdp += `${line}\r\n`;
    }
  }
  if (!ddAdded) {
    throw new Error('Failed to add dependency descriptor');
  }
  if (!packetizationAdded) {
    throw new Error('Failed to add packetizatio');
  }
  return newSdp;
}

function VideoPipe(stream, forceSend, forceReceive, handler) {
  this.pc1 = new RTCPeerConnection({
    encodedInsertableStreams: forceSend,
  });
  this.pc2 = new RTCPeerConnection({
    encodedInsertableStreams: forceReceive,
  });

  stream.getTracks().forEach((track) => this.pc1.addTrack(track, stream));
  this.pc2.ontrack = handler;
  if (preferredVideoCodecMimeType && 'setCodecPreferences' in window.RTCRtpTransceiver.prototype) {
    const {codecs} = RTCRtpSender.getCapabilities('video');
    const selectedCodecIndex = codecs.findIndex(c => c.mimeType === preferredVideoCodecMimeType);
    const selectedCodec = codecs[selectedCodecIndex];
    codecs.splice(selectedCodecIndex, 1);
    codecs.unshift(selectedCodec);
    const transceiver = this.pc1.getTransceivers().find(t => t.sender && t.sender.track === stream.getVideoTracks()[0]);
    transceiver.setCodecPreferences(codecs);
  }
}

VideoPipe.prototype.negotiate = async function() {
  this.pc1.onicecandidate = e => this.pc2.addIceCandidate(e.candidate);
  this.pc2.onicecandidate = e => this.pc1.addIceCandidate(e.candidate);

  const offer = await this.pc1.createOffer();
  offer.sdp = mungeSdp(offer.sdp);
  await this.pc2.setRemoteDescription({type: 'offer', sdp: offer.sdp.replace('red/90000', 'green/90000')});
  await this.pc1.setLocalDescription(offer);

  const answer = await this.pc2.createAnswer();
  answer.sdp = mungeSdp(answer.sdp);
  await this.pc1.setRemoteDescription(answer);
  await this.pc2.setLocalDescription(answer);
};

VideoPipe.prototype.close = function() {
  this.pc1.close();
  this.pc2.close();
};