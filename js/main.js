(function () {
  "use strict";

  // DOM
  var eltBackground = document.getElementById("background");
  var eltScore = document.getElementById("score");
  var eltResult = document.getElementById("result");
  var eltCanvas = document.getElementById("canvas");
  var backgroundRect = eltBackground.getBoundingClientRect();
  var diagonal = (function() {
    var dx = backgroundRect.width;
    var dy = backgroundRect.height;
    return Math.sqrt(dx * dx, dy * dy);
  })();

  // Canvas

  var imgSprites = new window.Image();
  imgSprites.src = "img/sombrero_piranha.png";

  var canvasContext = eltCanvas.getContext("2d");

  // Gameplay options.
  var Options = {
    // The speed of the sombrero, in pixels per milliseconds
    sombreroSpeedFactor: 0.3,

    // The speed of piranhas, in pixels per milliseconds
    piranhaSpeedFactor: 0.2,

    // General speed factor
    speedFactor: diagonal / 1000,

    // The leniency of collision, in pixels (decrease this value
    // to make collisions more likely).
    collisionMargin: 3,

    // The number of piranhas to spawn when the game starts
    initialNumberOfPiranhas: 18,

    // Set to |true| to compute and display debug information
    debug: false,

    // Set to |true| to remove collision detection
    debugNoCollisions: false,

    // Set to |true| to remove movements
    debugNoMovements: false,

    debugMoveWithTransitions: false,

    profileCollisions: false,
    profileMovement: false,
    profileCleanup: false,
    profileScore: false
  };

  // Statistics, useful for debugging
  var Statistics = {
    frame: 0,
    userTime: 0,
    collTime: 0,
    movTime: 0,
    framesSinceLastMeasure: 0,
    dateOfLastMeasure: 0,
    text: ""
  };

  // Compatibility
  if (!("KeyEvent" in window)) {
    // Chrome does not define key event constants
    window.KeyEvent = {
      DOM_VK_ESCAPE: 27,
      DOM_VK_SPACE: 32,
      DOM_VK_LEFT: 37,
      DOM_VK_UP: 38,
      DOM_VK_RIGHT: 39,
      DOM_VK_DOWN: 40
    };
  }


  var Cache = {
    // Optimization: reusing DOM nodes
    _divElements: [],
    getDivElement: function() {
      var elt;
      if (this._divElements.length != 0) {
        elt = this._divElements.pop();
        elt.classList.remove("cache");
      } else {
        elt = document.createElement("div");
        document.body.appendChild(elt);
      }
      return elt;
    },
    recycle: function(elt) {
      elt.removeEventListener("transitionend", onrecycle);
      elt.className = "cache";
      this._divElements.push(elt);
    },
    _transformPropertyName: null,
    get transformPropertyName() {
      if (this._transformPropertyName) {
        return this._transformPropertyName;
      }
      var names = [
        "transform",
        "WebkitTransform",
        "msTransform",
        "MozTransform",
        "OTransform"
      ];
      for (var i = 0; i < names.length; ++i) {
        if (typeof eltBackground.style[names[i]] != "undefined") {
          return this._transformPropertyName = names[i];
        }
      }
      return null;
    }
  };
  var onrecycle = function onrecycle(e) {
    Cache.recycle(e.target);
  };

  var collisionDistance = 29;

  /**
   * Implementation of a Sprite
   *
   * @param {Image} image The sprite sheet.
   * @param frames
   * @constructor
   */
  var Sprite = function Sprite(
    frames,
    x, y) {
    this._frames = frames;
    this.x = x || 0;
    this.y = y || 0;
    this.state = 0;
  };
  Sprite.prototype = {
    update: function update() {
      var frame = this._frames[this.state];
      // Draw image
      canvasContext.drawImage(
        frame.image,
        frame.x,
        frame.y,
        frame.w,
        frame.h,
        Math.round(this.x),
        Math.round(this.y),
        frame.w,
        frame.h
      );
    },
    die: function die() {
    },
    reset: function reset() {
      this.state = 0;
    }
  };

  var Sombrero = function Sombrero() {
    var frames = [{image: imgSprites,
                   x:0,
                   y:0,
                   w:32,
                   h:32}];
    Sprite.call(this, frames);
  };
  Sombrero.prototype = Object.create(Sprite.prototype);

  var Piranha = function Piranha(x, y) {
    var frames = [{image: imgSprites,
                   x:32,
                   y:0,
                   w:32,
                   h:32}];
    Sprite.call(this, frames, x, y);
  };
  Piranha.prototype = Object.create(Sprite.prototype);

  var randomNotCenter = function randomNotCenter() {
    var random = Math.random();
    var result;
    if (random < 0.5) {
      result = random / 2;
    } else {
      result = (1 - random) / 2 + 0.75;
    }
    return result;
  };

  var Game = {
    start: function start() {
      // Reset PC
      state.me.reset();

      // Reset enemies
      var piranhas = document.getElementsByClassName("piranha");
      var i;
      var element;
      while(piranhas.length) {
        Cache.recycle(piranhas[0]);
      }

      piranhas = [];
      var width = eltBackground.clientWidth;
      var height = eltBackground.clientHeight;
      for (i = 0; i < Options.initialNumberOfPiranhas; ++i) {
        var x = randomNotCenter() * width;
        var y = randomNotCenter() * height;
        var fish = new Piranha(x, y);
        fish.update();
        piranhas.push(fish);
      }
      state.piranhas = piranhas;
      state.me.x = width / 2;
      state.me.y = height / 2;

      // Clear score from previous game
      Statistics.framesSinceLastMeasure = 0;
      Statistics.userTime = 0;
      Statistics.collTime = 0;
      Statistics.movTime = 0;
      Statistics.cleanTime = 0;
      Statistics.scoreTime = 0;
      Statistics.dateOfLastMeasure = Date.now();
      if (Options.debug) {
        Statistics.text = "<measuring> ";
      }
      this.frameNumber = 0;
      this.timestamp = Date.now();
      this.previousStamp = 0;
      this.chunkDuration = 0;
      this.actualTimePlayed = 0;
      this.isOver = false;
      requestAnimationFrame(step);
    },
    pause: function pause() {
      if (this.isOver) {
        return;
      }
      if (this.isPaused) {
        this.isPaused = false;
        // Allow to resume the game
        this.chunkStart = Date.now();
        this.timestamp = Date.now();
        requestAnimationFrame(step);
      } else {
        this.isPaused = true;
      }
    },
    onblur: function onblur() {
      if (this.isOver || this.isPaused) {
        return;
      }
      else {
        this.isPaused = true;
      }
    },
    over: function over(isVictory) {
      this.clearScreen();
      var text;
      canvasContext.font = "bold xx-large 'Synchro LET',monospace";
      if (isVictory) {
        text = "Victoria, my sombrero!";
        canvasContext.fillStyle = "white";
      } else {
        text = "Game over, my sombrero! :(";
        canvasContext.fillStyle = "red";
      }
      var width = eltBackground.clientWidth;
      var height = eltBackground.clientHeight;
      var measure = canvasContext.measureText(text);
      canvasContext.fillText(text,
                             (width - measure.width) / 2,
                             height / 2);
      var restart = function restart() {
        document.removeEventListener("click", restart);
        document.removeEventListener("touchend", restart);
        return Game.start();
      };
      window.setTimeout(function() {
        document.addEventListener("click", restart);
        document.addEventListener("touchend", restart);
      }, 500);
    },
    handleTime: function handleTime(timestamp) {
      var frameDuration = timestamp - this.timestamp;
      this.previousStamp = this.timestamp;
      this.timestamp = timestamp;
      this.chunkDuration = frameDuration;
      ++this.frameNumber;
      this.actualTimePlayed += frameDuration;
    },
    handleMovement: function handleMovement() {
      if (Options.debugNoMovements) {
        // Skip movement, for debugging purposes
        return;
      }
      if (Options.profileMovement) {
        var timeStart = Date.now();
      }
      var player_multiply = this.chunkDuration * Options.sombreroSpeedFactor * Options.speedFactor;
      var piranha_multiply = this.chunkDuration * Options.piranhaSpeedFactor * Options.speedFactor;


      var width = eltBackground.clientWidth;
      var height = eltBackground.clientHeight;

      // Cache this for performance
      var myX = state.me.x;
      var myY = state.me.y;

      // Handle movement
      state.me.x = boundBy(myX + state.delta.x * player_multiply,
        0, width);
      state.me.y = boundBy(myY + state.delta.y * player_multiply,
        0, height);
      state.me.update();

      for (var i = 0; i < state.piranhas.length; ++i) {
        var fish = state.piranhas[i];
        if (!fish) {  // Don't update for fishes that have eaten each other
          continue;
        }
        var delta = normalizeDelta(fish.x - myX, fish.y - myY, piranha_multiply);
        if (delta) {
          fish.x = boundBy(fish.x - Math.round(delta.dx), 0, width);
          fish.y = boundBy(fish.y - Math.round(delta.dy), 0, height);
          fish.update();
        }
      }
      if (Options.profileMovement) {
        var timeStop = Date.now();
        Statistics.movTime += timeStop - timeStart;
      }
    },
    handleCleanup: function handleCleanup() {
      if (Options.debugNoCleanup) {
        // Skip collision detection, for debugging purposes
        return;
      }
//      if (this.frameNumber%2 == 0) {
//        return;
//      }
      if (Options.profileCleanup) {
        var timeStart = Date.now();
      }
      // Every second frame, clean up state.piranhas
      state.piranhas = state.piranhas.filter(
        function(x) {
          return x != null;
        }
      );
      state.piranhas.sort(
        function compare(a, b) {
          return a == null || (b != null && a.x <= b.x);
        }
      );
      if (state.piranhas.length <= 1) {
        this.isOver = true;
        this.isVictory = true;
      }
      if (Options.profileCleanup) {
        var timeStop = Date.now();
        Statistics.cleanTime += timeStop - timeStart;
      }
    },
    handleCollisions: function handleCollision() {
      if (Options.debugNoCollisions) {
        // Skip collision detection, for debugging purposes
        return;
      }
//      if (this.frameNumber%2 == 1) {
//        return;
//      }
      if (Options.profileCollisions) {
        var timeStart = Date.now();
      }
      // Every second frame, detect collisions
      var collisionDetections = 0;
      var length = state.piranhas.length;
      var half = Math.ceil(length);
      // Detect collisions of fishes between [start, stop[
      var fish, fish2;
      var i, j;
      var dx, dy;

      // Collisions between a fish and the sombrero
      for (i = 0; i < length; ++i) {
        fish = state.piranhas[i];
        if (!fish) {
          continue;
        }
        collisionDetections++;
        dx = fish.x - state.me.x;
        dy = fish.y - state.me.y;

        if (dx * dx + dy * dy < collisionDistance * collisionDistance) {
          state.me.die();
          this.isOver = true;
          this.isVictory = false;
          return;
        }
      }

      // Collisions between two fishes
      for (i = 0; i < length; ++i) {
        fish = state.piranhas[i];
        if (!fish) {
          // If the fish has been eliminated, skip it
          continue;
        }

        for (j = i + 1; j < length; ++j) {
          fish2 = state.piranhas[j];
          if (!fish2) {
            // If the fish has been eliminated, skip it
            continue;
          }

          collisionDetections++;
          dx = fish2.x - fish.x; // Necessarily >= 0
          if (dx >= collisionDistance) {
            // If fish2 is too far on the right, all further
            // fishes are too far on the right
            break;
          }
          if (dx * dx >= collisionDistance * collisionDistance) {
            continue;
          }

          dy = fish2.y - fish.y;
          if (dy * dy < collisionDistance * collisionDistance) {
            // We have a collision
            fish.die();
            fish2.die();
            state.piranhas[i] = null;
            state.piranhas[j] = null;
          }
        }
      }

      if (Options.profileCollisions) {
        var timeStop = Date.now();
        Statistics.collTime += timeStop - timeStart;
      }
    },
    handleScore: function handleScore() {
      if (Options.profileScore) {
        var timeStart = Date.now();
      }
      eltScore.textContent = Statistics.text + "Score: " + this.actualTimePlayed;
      if (Options.profileScore) {
        var timeStop = Date.now();
        Statistics.scoreTime += timeStop - timeStart;
      }
    },
    handleStatistics: function handleStatistics(timestamp) {
      if (!Options.debug) {
        return;
      }
      var now = Date.now();
      Statistics.framesSinceLastMeasure++;
      Statistics.userTime += now - timestamp;
      var deltaT = now - Statistics.dateOfLastMeasure;
      if (deltaT > 1000) {
        var userTime = Statistics.userTime / Statistics.framesSinceLastMeasure;
        var fps = (1000 * Statistics.framesSinceLastMeasure) / deltaT;
        var text = Math.round(fps) + "fps, " + round(userTime) + "user, ";

        if (Options.profileCollisions) {
          var collTime = Statistics.collTime / Statistics.framesSinceLastMeasure;
          text += round(collTime) + "coll, ";
        }
        if (Options.profileCleanup) {
          var cleanTime = Statistics.cleanTime / Statistics.framesSinceLastMeasure;
          text += round(cleanTime) + "clean, ";
        }
        if (Options.profileMovement) {
          var movTime = Statistics.movTime / Statistics.framesSinceLastMeasure;
          text += round(movTime) + "mov, ";
        }
        if (Options.profileScore) {
          var scoreTime = Statistics.scoreTime / Statistics.framesSinceLastMeasure;
          text += round(scoreTime) + "score, ";
        }
        Statistics.text = text;
        Statistics.framesSinceLastMeasure = 0;
        Statistics.dateOfLastMeasure = now;
        Statistics.userTime = 0;
        Statistics.collTime = 0;
        Statistics.movTime = 0;
        Statistics.scoreTime = 0;
        Statistics.cleanTime = 0;
      }
    },
    clearScreen: function clearScreen() {
      canvasContext.clearRect(0, 0, eltCanvas.width, eltCanvas.height);
    },
    /**
     * true if the game is paused, false otherwise
     */
    isPaused: false,
    isOver: false,
    isVictory: false,
    /**
     * How many frames have been shown since the start of the game
     *
     * @type {number}
     */
    frameNumber: 0,
    /**
     * The date at which the latest |step| has started
     *
     * @type {number}
     */
    timestamp: 0,
    /**
     * The date at which the previous |step| has started
     *
     * @type {number}
     */
    previousStamp: 0,
    chunkDuration: 0,
    actualTimePlayed:0
  };

  var state = {
    delta: {
      x: 0,
      y: 0
    },
    me: new Sombrero(0, 0),
    piranhas: null
  };

  // Create the piranhas


  // Main event loop

  var requestAnimationFrame =
    window.requestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.msRequestAnimationFrame;

  if (!requestAnimationFrame) {
    alert("This application requires a browser implementing requestAnimationFrame");
    throw new Error("This application requires a browser implementing requestAnimationFrame");
  }

  var step = function step(timestamp) {
    Game.handleTime(timestamp);
    if (Game.isPaused) {
      return;
    }
    if (Game.isOver) {
      Game.over(Game.isVictory);
      return;
    }
    Game.clearScreen();
    Game.handleMovement();
    Game.handleCleanup();
    Game.handleCollisions();
    Game.handleScore();
    Game.handleStatistics(timestamp);

    // Loop
    requestAnimationFrame(step);
  };

  // Handle inputs

  var onkeypress = function onkeypress(event) {
    var code;
    if ("key" in event) {
      console.error("FIXME: Handle event.key");
    }
    if ("keyCode" in event || "which" in event) {
      code = event.keyCode || event.which;
      if (code == window.KeyEvent.DOM_VK_UP) {
        if (state.delta.y >= 0) {
          state.delta.y = -1;
        }
      } else if (code == window.KeyEvent.DOM_VK_DOWN) {
        if (state.delta.y <= 0) {
          state.delta.y = 1;
        }
      } else if (code == window.KeyEvent.DOM_VK_LEFT) {
        if (state.delta.x >= 0) {
          state.delta.x = -1;
        }
      } else if (code == window.KeyEvent.DOM_VK_RIGHT) {
        if (state.delta.x <= 0) {
          state.delta.x = 1;
        }
      } else if (code == window.KeyEvent.DOM_VM_ESCAPE || code == window.KeyEvent.DOM_VK_SPACE) {
        Game.pause();
      }
      return;
    }
    console.error("Could not determine key");
  };

  /**
   * Return the value in an interval closest to `x`.
   *
   * If `x` is between `min` and `max`, return `x`.
   * Otherwise, if `x` is below `min`, return `min`.
   * Otherwise, `x` is larger than `max`, return `max`.
   */
  var boundBy = function boundBy(x, min, max) {
    if (x <= min) {
      return min;
    }
    if (x >= max) {
      return max;
    }
    return x;
  };

  var round = function round(x) {
    return Math.round(100 * x) / 100;
  };

  var EPSILON = 0.01;
  var normalizeDelta = function normalizeDelta(dx, dy, desiredNorm) {
    var norm = Math.sqrt( dx * dx + dy * dy);
    if (norm <= EPSILON) {
      return null;
    }
    dx = (dx / norm) * desiredNorm;
    if (isNaN(dx)) {
      return null;
    }
    dy = (dy / norm) * desiredNorm;
    if (isNaN(dy)) {
      return null;
    }
    return {dx: dx, dy: dy};
  };

  var onmousemove = function onmousemove(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.target == state.me.elt) {
      // Prevent some shaking
      state.delta.x = 0;
      state.delta.y = 0;
      return;
    }
    var dx = event.clientX - state.me.x;
    var dy = event.clientY - state.me.y;

    var delta = normalizeDelta(dx, dy, 1);
    if (delta) {
      state.delta.x = delta.dx;
      state.delta.y = delta.dy;
    }
  };

  window.addEventListener("keydown", onkeypress);
  window.addEventListener("blur", Game.onblur.bind(Game));
  document.addEventListener("mousemove", onmousemove);
  document.addEventListener("touchmove", onmousemove);

  eltCanvas.setAttribute("width", backgroundRect.width);
  eltCanvas.setAttribute("height", backgroundRect.height);
  imgSprites.onload = function() {
    Game.start();
  };

  window.Piranhas = {
    options: Options,
    statistics: Statistics
  };
})();