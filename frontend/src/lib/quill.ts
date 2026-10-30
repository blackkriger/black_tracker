import Quill from 'quill/core';
import Blockquote from 'quill/formats/blockquote';
import Bold from 'quill/formats/bold';
import CodeBlock, { Code } from 'quill/formats/code';
import Header from 'quill/formats/header';
import Image from 'quill/formats/image';
import Italic from 'quill/formats/italic';
import Link from 'quill/formats/link';
import List from 'quill/formats/list';
import Strike from 'quill/formats/strike';

Quill.register(
  {
    'formats/blockquote': Blockquote,
    'formats/bold': Bold,
    'formats/code': Code,
    'formats/code-block': CodeBlock,
    'formats/header': Header,
    'formats/image': Image,
    'formats/italic': Italic,
    'formats/link': Link,
    'formats/list': List,
    'formats/strike': Strike,
  },
  true
);

export default Quill;
