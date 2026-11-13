// A local stand-in for Razorpay Checkout (https://checkout.razorpay.com/v1/checkout.js), served
// only when THREAD_PAYMENT_PROVIDER=fake outside production. It offers the same small surface
// Thread uses (new Razorpay(options), .on("payment.failed"), .open()) and settles the fake
// order through /api/billing/fake/pay. No money moves and nothing leaves this machine.
(function () {
  "use strict";

  function FakeRazorpay(options) {
    this.options = options;
    this.handlers = {};
  }

  FakeRazorpay.prototype.on = function (event, handler) {
    this.handlers[event] = handler;
  };

  FakeRazorpay.prototype.open = function () {
    var self = this;
    var options = self.options;
    var previousFocus = document.activeElement;

    var backdrop = document.createElement("div");
    backdrop.setAttribute("data-fake-checkout", "");
    backdrop.style.cssText =
      "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(20,20,20,0.55);padding:16px";

    var dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "fake-checkout-title");
    dialog.style.cssText =
      "background:#fff;color:#111;max-width:24rem;width:100%;padding:24px;font:14px/1.5 system-ui,sans-serif";

    var title = document.createElement("h2");
    title.id = "fake-checkout-title";
    title.textContent = "Test checkout";
    title.style.cssText = "margin:0 0 8px;font-size:18px";

    var detail = document.createElement("p");
    detail.textContent =
      (options.description || "") + " · " + (options.amount / 100).toFixed(2) + " " + options.currency +
      ". A local stand-in for Razorpay: no money moves.";
    detail.style.cssText = "margin:0 0 16px";

    dialog.appendChild(title);
    dialog.appendChild(detail);

    function close() {
      backdrop.remove();
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }

    function settle(outcome) {
      return fetch("/api/billing/fake/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ order_id: options.order_id, outcome: outcome }),
      }).then(function (response) {
        if (!response.ok) throw new Error("The test checkout could not settle the order.");
        return response.json();
      });
    }

    function button(label, onClick) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText =
        "display:block;width:100%;margin-top:8px;padding:10px;border:1px solid #111;background:#fff;color:#111;cursor:pointer";
      b.addEventListener("click", onClick);
      dialog.appendChild(b);
      return b;
    }

    var first = button("Pay (test)", function () {
      settle("captured").then(function (result) {
        close();
        options.handler(result);
      });
    });
    button("Authorise only (test)", function () {
      settle("authorized").then(function (result) {
        close();
        options.handler(result);
      });
    });
    button("Decline (test)", function () {
      // Like Razorpay, a failed attempt leaves the checkout open for another try.
      settle("failed").then(function (result) {
        if (self.handlers["payment.failed"]) self.handlers["payment.failed"](result);
      });
    });
    button("Close", function () {
      close();
      if (options.modal && options.modal.ondismiss) options.modal.ondismiss();
    });

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    first.focus();
  };

  window.Razorpay = FakeRazorpay;
})();
