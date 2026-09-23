(function(){
  if (customElements.get('lc-icon')) return;
  var st = document.createElement('style');
  st.textContent = 'lc-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;line-height:0}lc-icon>span,lc-icon>svg{display:block;flex:none}';
  document.head.appendChild(st);
  var waiting = [];
  if (!window.lucide) {
    var sc = document.createElement('script');
    sc.src = 'https://unpkg.com/lucide@0.474.0/dist/umd/lucide.min.js';
    sc.onload = function(){ waiting.splice(0).forEach(function(el){ el.apply(); }); };
    document.head.appendChild(sc);
  }
  function pascal(n){ return n.split('-').map(function(p){ return p.charAt(0).toUpperCase() + p.slice(1); }).join(''); }
  class LcIcon extends HTMLElement {
    static get observedAttributes(){ return ['name','size']; }
    connectedCallback(){ this.apply(); }
    attributeChangedCallback(){ if (this.isConnected) this.apply(); }
    apply(){
      var n = this.getAttribute('name') || 'circle';
      var s = parseFloat(this.getAttribute('size') || '14');
      var L = window.lucide, node = L && L.icons && L.icons[pascal(n)];
      var child;
      if (node) {
        child = L.createElement(node);
        child.setAttribute('width', s); child.setAttribute('height', s);
        child.setAttribute('stroke', 'currentColor');
      } else {
        if (!L) waiting.push(this);
        var u = 'url(https://unpkg.com/lucide-static@0.474.0/icons/' + n + '.svg)';
        child = document.createElement('span');
        child.style.cssText = 'width:' + s + 'px;height:' + s + 'px;background-color:currentColor;-webkit-mask:' + u + ' center/contain no-repeat;mask:' + u + ' center/contain no-repeat';
      }
      var root = this.shadowRoot || this.attachShadow({ mode: 'open' });
      child.style.display = 'block';
      root.replaceChildren(child);
    }
  }
  customElements.define('lc-icon', LcIcon);
})();
