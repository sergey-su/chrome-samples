/*
 *  Copyright (c) 2020 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

/*
 * This is a worker doing the encode/decode transformations to add end-to-end
 * encryption to a WebRTC PeerConnection using the Insertable Streams API.
 */

'use strict';
let audioPayloadSize = 0;
let videoPayloadSize = 0;

function dump(encodedFrame, direction, max = 16) {
  const data = new Uint8Array(encodedFrame.data);
  let bytes = '';
  for (let j = 0; j < data.length && j < max; j++) {
    bytes += (data[j] < 16 ? '0' : '') + data[j].toString(16) + ' ';
  }
  console.log(performance.now().toFixed(2), direction, bytes.trim(),
      'len=' + encodedFrame.data.byteLength,
      'type=' + (encodedFrame.type || 'audio'),
      'ts=' + encodedFrame.timestamp,
      'ssrc=' + encodedFrame.getMetadata().synchronizationSource,
      'pt=' + (encodedFrame.getMetadata().payloadType || '(unknown)')
  );
}

let scount = 0;
function encodeFunction(encodedFrame, controller) {
  if (scount++ < 30) { // dump the first 30 packets.
    dump(encodedFrame, 'send');
  }
  const metadataSize = ((encodedFrame.type || 'audio') === 'audio')
    ? audioPayloadSize : videoPayloadSize;
  const view = new DataView(encodedFrame.data);
  const newData = new ArrayBuffer(encodedFrame.data.byteLength + 4 + metadataSize);
  const newView = new DataView(newData);

  for (let i = 0; i < encodedFrame.data.byteLength; ++i) {
    newView.setInt8(i + 4, view.getInt8(i));
  }
  newView.setUint32(0, encodedFrame.data.byteLength);

  encodedFrame.data = newData;
  controller.enqueue(encodedFrame);
}

let rcount = 0;
function decodeFunction(encodedFrame, controller) {
  if (rcount++ < 30) { // dump the first 30 packets
    dump(encodedFrame, 'recv');
  }
  if (encodedFrame.data.byteLength > 0) {
    const view = new DataView(encodedFrame.data);
    const encodedFrameSize = view.getUint32(0);
    if (rcount % 100 == 0) {
      console.log('decoding frame ', encodedFrame.type, 'with metadata size',
        encodedFrame.data.byteLength - encodedFrameSize - 4);
    }

    const newData = new ArrayBuffer(encodedFrameSize);
    const newView = new DataView(newData);
    for (let i = 0; i < encodedFrameSize; ++i) {
      newView.setInt8(i, view.getInt8(4 + i));
    }
    encodedFrame.data = newData;
  }
  controller.enqueue(encodedFrame);
}

function handleTransform(operation, readable, writable) {
  if (operation === 'encode') {
    const transformStream = new TransformStream({
      transform: encodeFunction,
    });
    readable
        .pipeThrough(transformStream)
        .pipeTo(writable);
  } else if (operation === 'decode') {
    const transformStream = new TransformStream({
      transform: decodeFunction,
    });
    readable
        .pipeThrough(transformStream)
        .pipeTo(writable);
  }
}

// Handler for messages, including transferable streams.
onmessage = (event) => {
  if (event.data.operation === 'encode' || event.data.operation === 'decode') {
    return handleTransform(event.data.operation, event.data.readable, event.data.writable);
  }
  if (event.data.operation === 'setCryptoKey') {
  }
  if (event.data.operation === 'setPayloadSize') {
    if (event.data.mediaType === 'audio') {
      audioPayloadSize = event.data.value;
    } else {
      videoPayloadSize = event.data.value;
    }
  }
};

// Handler for RTCRtpScriptTransforms.
if (self.RTCTransformEvent) {
  self.onrtctransform = (event) => {
    const transformer = event.transformer;
    handleTransform(transformer.options.operation, transformer.readable, transformer.writable);
  };
}
