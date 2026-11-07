'use strict';
module.exports = function drawing(style = '8bit') {
  const width = style === '8bit' ? 48 : 64,
    height = style === '8bit' ? 64 : 96;
  const x = width / 2,
    y = Math.floor(height / 3);
  const poly = (color, points) => ({ type: 'polygon', color, points });
  const line = (color, points) => ({ type: 'line', color, points });
  const face = (mouthY, mouthColor = 0) => [
    line(0, [
      [x - 4, y - 3],
      [x - 3, y - 3],
    ]),
    line(0, [
      [x + 3, y - 3],
      [x + 4, y - 3],
    ]),
    line(mouthColor, [
      [x - 1, mouthY],
      [x + 1, mouthY],
    ]),
  ];
  return {
    version: 1,
    width,
    height,
    palette: ['#29213f', '#d996c1', '#ffe1cf', '#656ac4', '#ffffff'],
    joints: { head: [x, y + 6], leftArm: [x - 7, y + 8], rightArm: [x + 7, y + 8] },
    parts: [
      {
        joint: 'body',
        shapes: [
          poly(3, [
            [x - 6, y + 5],
            [x + 6, y + 5],
            [x + 9, height - 10],
            [x - 9, height - 10],
          ]),
          poly(0, [
            [x - 6, height - 10],
            [x - 2, height - 10],
            [x - 2, height - 4],
            [x - 6, height - 4],
          ]),
          poly(0, [
            [x + 2, height - 10],
            [x + 6, height - 10],
            [x + 6, height - 4],
            [x + 2, height - 4],
          ]),
        ],
      },
      {
        joint: 'head',
        shapes: [
          poly(1, [
            [x - 9, y - 12],
            [x + 9, y - 12],
            [x + 10, y + 5],
            [x - 10, y + 5],
          ]),
          poly(2, [
            [x - 6, y - 7],
            [x + 6, y - 7],
            [x + 6, y + 4],
            [x - 6, y + 4],
          ]),
          poly(1, [
            [x - 8, y - 11],
            [x + 7, y - 11],
            [x + 6, y - 5],
            [x - 5, y - 6],
          ]),
        ],
      },
      {
        joint: 'leftArm',
        shapes: [
          poly(2, [
            [x - 9, y + 8],
            [x - 6, y + 8],
            [x - 6, y + 21],
            [x - 9, y + 21],
          ]),
        ],
      },
      {
        joint: 'rightArm',
        shapes: [
          poly(2, [
            [x + 6, y + 8],
            [x + 9, y + 8],
            [x + 9, y + 21],
            [x + 6, y + 21],
          ]),
        ],
      },
    ],
    faces: {
      neutral: face(y + 1),
      happy: face(y + 2, 1),
      thinking: face(y),
      sad: face(y + 3),
      sleepy: [
        line(0, [
          [x - 5, y - 3],
          [x - 2, y - 3],
        ]),
        line(0, [
          [x + 2, y - 3],
          [x + 5, y - 3],
        ]),
        line(0, [
          [x - 1, y + 2],
          [x + 1, y + 2],
        ]),
      ],
      surprised: [
        ...face(y + 1),
        poly(0, [
          [x - 1, y],
          [x + 1, y],
          [x + 1, y + 3],
          [x - 1, y + 3],
        ]),
      ],
      blink: [
        line(0, [
          [x - 5, y - 3],
          [x - 2, y - 3],
        ]),
        line(0, [
          [x + 2, y - 3],
          [x + 5, y - 3],
        ]),
        line(0, [
          [x - 1, y + 1],
          [x + 1, y + 1],
        ]),
      ],
      talk: [
        ...face(y + 1),
        poly(0, [
          [x - 1, y],
          [x + 1, y],
          [x + 1, y + 2],
          [x - 1, y + 2],
        ]),
      ],
    },
  };
};
