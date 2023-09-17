/*
 *  Copyright (c) 2020 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

/* global RTCRtpScriptTransform */
/* global VideoPipe */

const video1 = document.querySelector('video#video1');
const video2 = document.querySelector('video#video2');
const videoMonitor = document.querySelector('#video-monitor');

const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');

const banner = document.querySelector('#banner');
const muteMiddleBox = document.querySelector('#mute-middlebox');

startButton.onclick = start;
callButton.onclick = call;
hangupButton.onclick = hangup;

muteMiddleBox.addEventListener('change', toggleMute);

let startToEnd;

let localStream;
// eslint-disable-next-line no-unused-vars
let remoteStream;

let hasEnoughAPIs = !!window.RTCRtpScriptTransform;

if (!hasEnoughAPIs) {
  const supportsInsertableStreams =
      !!RTCRtpSender.prototype.createEncodedStreams;

  let supportsTransferableStreams = false;
  try {
    const stream = new ReadableStream();
    window.postMessage(stream, '*', [stream]);
    supportsTransferableStreams = true;
  } catch (e) {
    console.error('Transferable streams are not supported.');
  }
  hasEnoughAPIs = supportsInsertableStreams && supportsTransferableStreams;
}

if (!hasEnoughAPIs) {
  banner.innerText = 'Your browser does not support WebRTC Encoded Transforms. ' +
  'This sample will not work.';
  if (adapter.browserDetails.browser === 'chrome') {
    banner.innerText += ' Try with Enable experimental Web Platform features enabled from chrome://flags.';
  }
  startButton.disabled = true;
  cryptoKey.disabled = true;
  cryptoOffsetBox.disabled = true;
}

function gotStream(stream) {
  console.log('Received local stream');
  video1.srcObject = stream;
  localStream = stream;
  callButton.disabled = false;
}

function gotRemoteStream(stream) {
  console.log('Received remote stream');
  remoteStream = stream;
  video2.srcObject = stream;
}

function start() {
  console.log('Requesting local stream');
  startButton.disabled = true;
  const options = {audio: true, video: true};
  navigator.mediaDevices
      .getUserMedia(options)
      .then(gotStream)
      .catch(function(e) {
        alert('getUserMedia() failed');
        console.log('getUserMedia() error: ', e);
      });
}

// We use a Worker to do the encryption and decryption.
// See
//   https://developer.mozilla.org/en-US/docs/Web/API/Worker
// for basic concepts.
const worker = new Worker('./js/worker.js', {name: 'E2EE worker'});
function setupSenderTransform(sender) {
  if (window.RTCRtpScriptTransform) {
    sender.transform = new RTCRtpScriptTransform(worker, {operation: 'encode'});
    return;
  }

  const senderStreams = sender.createEncodedStreams();
  // Instead of creating the transform stream here, we do a postMessage to the worker. The first
  // argument is an object defined by us, the second is a list of variables that will be transferred to
  // the worker. See
  //   https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage
  // If you want to do the operations on the main thread instead, comment out the code below.
  /*
  const transformStream = new TransformStream({
    transform: encodeFunction,
  });
  senderStreams.readable
      .pipeThrough(transformStream)
      .pipeTo(senderStreams.writable);
  */
  const {readable, writable} = senderStreams;
  worker.postMessage({
    operation: 'encode',
    readable,
    writable,
  }, [readable, writable]);
}

function setupReceiverTransform(receiver) {
  if (window.RTCRtpScriptTransform) {
    receiver.transform = new RTCRtpScriptTransform(worker, {operation: 'decode'});
    return;
  }

  const receiverStreams = receiver.createEncodedStreams();
  const {readable, writable} = receiverStreams;
  worker.postMessage({
    operation: 'decode',
    readable,
    writable,
  }, [readable, writable]);
}

async function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  console.log('Starting call');

  startToEnd = new VideoPipe(localStream, true, true, e => {
    setupReceiverTransform(e.receiver);
    gotRemoteStream(e.streams[0]);
  });
  startToEnd.pc1.getSenders().forEach(setupSenderTransform);
  await startToEnd.negotiate();

  console.log('Video pipes created');
}

function hangup() {
  console.log('Ending call');
  startToEnd.close();
  hangupButton.disabled = true;
  callButton.disabled = false;
}

function toggleMute(event) {
  video2.muted = muteMiddleBox.checked;
  videoMonitor.muted = !muteMiddleBox.checked;
}

function setPayloadSize(elementName, mediaType) {
  const inputElement = document.getElementById(elementName);
  worker.postMessage({
    operation: 'setPayloadSize',
    value: parseInt(inputElement.value),
    mediaType
  });
}
