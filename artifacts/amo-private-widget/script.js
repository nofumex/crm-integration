define([], function () {
  return function () {
    this.callbacks = {
      render: function () { return true; },
      init: function () { return true; },
      bind_actions: function () { return true; },
      settings: function () { return true; },
      onSave: function () { return true; }
    };
  };
});
