self.addEventListener('message', msg => {
  console.log(msg);
  self.postMessage(42);
});

self.postMessage('hello');