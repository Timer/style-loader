/* eslint-disable */

var stylesInDom = {};

var memoize = function(fn) {
  var memo;

  return function() {
    if (typeof memo === 'undefined') {
      memo = fn.apply(this, arguments);
    }

    return memo;
  };
};

var isOldIE = memoize(function() {
  // Test for IE <= 9 as proposed by Browserhacks
  // @see http://browserhacks.com/#hack-e71d8692f65334173fee715c222cb805
  // Tests for existence of standard globals is to allow style-loader
  // to operate correctly into non-standard environments
  // @see https://github.com/webpack-contrib/style-loader/issues/177
  return window && document && document.all && !window.atob;
});

var getTarget = function(target, parent) {
  if (parent) {
    return parent.querySelector(target);
  }
  return document.querySelector(target);
};

var getElement = (function(fn) {
  var memo = {};

  return function(target, parent) {
    // If passing function in options, then use it for resolve "head" element.
    // Useful for Shadow Root style i.e
    // {
    //   insertInto: function () { return document.querySelector("#foo").shadowRoot }
    // }
    if (typeof target === 'function') {
      return target();
    }

    if (typeof memo[target] === 'undefined') {
      var styleTarget = getTarget.call(this, target, parent);

      // Special case to return head of iframe instead of iframe itself
      if (
        window.HTMLIFrameElement &&
        styleTarget instanceof window.HTMLIFrameElement
      ) {
        try {
          // This will throw an exception if access to iframe is blocked
          // due to cross-origin restrictions
          styleTarget = styleTarget.contentDocument.head;
        } catch (e) {
          styleTarget = null;
        }
      }

      memo[target] = styleTarget;
    }

    return memo[target];
  };
})();

var singleton = null;
var singletonCounter = 0;
var stylesInsertedAtTop = [];

module.exports = function(list, options) {
  if (typeof DEBUG !== 'undefined' && DEBUG) {
    if (typeof document !== 'object') {
      throw new Error(
        'The style-loader cannot be used in a non-browser environment'
      );
    }
  }

  options = options || {};

  options.attrs = typeof options.attrs === 'object' ? options.attrs : {};

  // Force single-tag solution on IE6-9, which has a hard limit on the # of <style>
  // tags it will allow on a page
  if (!options.singleton && typeof options.singleton !== 'boolean') {
    options.singleton = isOldIE();
  }

  // By default, add <style> tags to the <head> element
  if (!options.insertInto) {
    options.insertInto = 'head';
  }

  // By default, add <style> tags to the bottom of the target
  if (!options.insertAt) {
    options.insertAt = 'bottom';
  }

  var styles = listToStyles(list, options);

  addStylesToDom(styles, options);

  return function update(newList) {
    var mayRemove = [];

    for (var i = 0; i < styles.length; i++) {
      var item = styles[i];
      var domStyle = stylesInDom[item.id];

      domStyle.refs--;
      mayRemove.push(domStyle);
    }

    if (newList) {
      var newStyles = listToStyles(newList, options);

      addStylesToDom(newStyles, options);
    }

    for (var i = 0; i < mayRemove.length; i++) {
      var domStyle = mayRemove[i];

      if (domStyle.refs === 0) {
        for (var j = 0; j < domStyle.parts.length; j++) {
          domStyle.parts[j]();
        }

        delete stylesInDom[domStyle.id];
      }
    }
  };
};

function addStylesToDom(styles, options) {
  for (var i = 0; i < styles.length; i++) {
    var item = styles[i];
    var domStyle = stylesInDom[item.id];

    if (domStyle) {
      domStyle.refs++;

      for (var j = 0; j < domStyle.parts.length; j++) {
        domStyle.parts[j](item.parts[j]);
      }

      for (; j < item.parts.length; j++) {
        domStyle.parts.push(addStyle(item.parts[j], options));
      }
    } else {
      var parts = [];

      for (var j = 0; j < item.parts.length; j++) {
        parts.push(addStyle(item.parts[j], options));
      }

      stylesInDom[item.id] = { id: item.id, refs: 1, parts: parts };
    }
  }
}

function listToStyles(list, options) {
  var styles = [];
  var newStyles = {};

  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var id = options.base ? item[0] + options.base : item[0];
    var css = item[1];
    var media = item[2];
    var sourceMap = item[3];
    var part = { css: css, media: media, sourceMap: sourceMap };

    if (!newStyles[id]) {
      styles.push((newStyles[id] = { id: id, parts: [part] }));
    } else {
      newStyles[id].parts.push(part);
    }
  }

  return styles;
}

function insertStyleElement(options, style) {
  var target = getElement(options.insertInto);

  if (!target) {
    throw new Error(
      "Couldn't find a style target. This probably means that the value for the 'insertInto' parameter is invalid."
    );
  }

  var lastStyleElementInsertedAtTop =
    stylesInsertedAtTop[stylesInsertedAtTop.length - 1];

  if (options.insertAt === 'top') {
    if (!lastStyleElementInsertedAtTop) {
      target.insertBefore(style, target.firstChild);
    } else if (lastStyleElementInsertedAtTop.nextSibling) {
      target.insertBefore(style, lastStyleElementInsertedAtTop.nextSibling);
    } else {
      target.appendChild(style);
    }

    stylesInsertedAtTop.push(style);
  } else if (options.insertAt === 'bottom') {
    target.appendChild(style);
  } else if (typeof options.insertAt === 'object' && options.insertAt.before) {
    var nextSibling = getElement(options.insertAt.before, target);

    target.insertBefore(style, nextSibling);
  } else {
    throw new Error(
      "[Style Loader]\n\n Invalid value for parameter 'insertAt' ('options.insertAt') found.\n Must be 'top', 'bottom', or Object.\n (https://github.com/webpack-contrib/style-loader#insertat)\n"
    );
  }
}

function removeStyleElement(style) {
  if (style.parentNode === null) {
    return false;
  }

  style.parentNode.removeChild(style);

  var idx = stylesInsertedAtTop.indexOf(style);

  if (idx >= 0) {
    stylesInsertedAtTop.splice(idx, 1);
  }
}

function createStyleElement(options) {
  var style = document.createElement('style');

  if (options.attrs.type === undefined) {
    options.attrs.type = 'text/css';
  }

  if (options.attrs.nonce === undefined) {
    var nonce = getNonce();

    if (nonce) {
      options.attrs.nonce = nonce;
    }
  }

  addAttrs(style, options.attrs);
  insertStyleElement(options, style);

  return style;
}

function addAttrs(el, attrs) {
  Object.keys(attrs).forEach(function(key) {
    el.setAttribute(key, attrs[key]);
  });
}

function getNonce() {
  if (typeof __webpack_nonce__ === 'undefined') {
    return null;
  }

  return __webpack_nonce__;
}

function addStyle(obj, options) {
  var style, update, remove, result;

  // If a transform function was defined, run it on the css
  if (options.transform && obj.css) {
    result =
      typeof options.transform === 'function'
        ? options.transform(obj.css)
        : options.transform.default(obj.css);

    if (result) {
      // If transform returns a value, use that instead of the original css.
      // This allows running runtime transformations on the css.
      obj.css = result;
    } else {
      // If the transform function returns a falsy value, don't add this css.
      // This allows conditional loading of css
      return function() {
        // noop
      };
    }
  }

  if (options.singleton) {
    var styleIndex = singletonCounter++;

    style = singleton || (singleton = createStyleElement(options));

    update = applyToSingletonTag.bind(null, style, styleIndex, false);
    remove = applyToSingletonTag.bind(null, style, styleIndex, true);
  } else {
    style = createStyleElement(options);
    update = applyToTag.bind(null, style);
    remove = function() {
      removeStyleElement(style);
    };
  }

  update(obj);

  return function updateStyle(newObj) {
    if (newObj) {
      if (
        newObj.css === obj.css &&
        newObj.media === obj.media &&
        newObj.sourceMap === obj.sourceMap
      ) {
        return;
      }

      update((obj = newObj));
    } else {
      remove();
    }
  };
}

var replaceText = (function() {
  var textStore = [];

  return function(index, replacement) {
    textStore[index] = replacement;

    return textStore.filter(Boolean).join('\n');
  };
})();

function applyToSingletonTag(style, index, remove, obj) {
  var css = remove ? '' : obj.css;

  if (style.styleSheet) {
    style.styleSheet.cssText = replaceText(index, css);
  } else {
    var cssNode = document.createTextNode(css);
    var childNodes = style.childNodes;

    if (childNodes[index]) {
      style.removeChild(childNodes[index]);
    }

    if (childNodes.length) {
      style.insertBefore(cssNode, childNodes[index]);
    } else {
      style.appendChild(cssNode);
    }
  }
}

function applyToTag(style, obj) {
  var css = obj.css;
  var media = obj.media;
  var sourceMap = obj.sourceMap;

  if (media) {
    style.setAttribute('media', media);
  }

  if (sourceMap) {
    css +=
      '\n/*# sourceURL=' + sourceMap.sources[0] + ' */'
      // http://stackoverflow.com/a/26603875
      '\n/*# sourceMappingURL=data:application/json;base64,' +
      btoa(unescape(encodeURIComponent(JSON.stringify(sourceMap)))) + ' */'
  }

  if (style.styleSheet) {
    style.styleSheet.cssText = css;
  } else {
    while (style.firstChild) {
      style.removeChild(style.firstChild);
    }

    style.appendChild(document.createTextNode(css));
  }
}