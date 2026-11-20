// A receiver that does the two things every receiver should: it answers each
// message it could read, and it says so when one arrives that it could not.
onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.careless !== undefined) { careful = !data.careless; return; }
    port.postMessage({ ack: data.id, got: Object.prototype.toString.call(data.value).slice(8, -1) });
  };
  let careful = true;
  // The message is gone by the time this fires. All that can be said is that one was lost.
  port.onmessageerror = () => { if (careful) port.postMessage({ unreadable: true }); };
};
