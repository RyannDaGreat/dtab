//DJSON Warnings:
//	Don't use blank lines! It can be dangerous. If you use a COMPLETELY blank line (no whitespace), it will erase the rest of the current scope until the next unindented entry (this is because a blank line can be interpereted as a key called "". So, if you use another blank line later on, it will erase the previous value, and it will look as though values have been deleted.) They can be fine when written by a machine, but they're dangerous to try writing by hand (watch out for duplicate value warnings! Those are why thigns get overwritten)
//	We can make warnings about duplicate values
const djson=proxies.argumentCountChecker({
	symbol:'@',//If symbols are enabled, this is the key name that will represent them
	symbols_enabled:true,
	random_symbol()
	{
		return '!!'+Math.random()//We use this because for some stupid reason symbols are not enumerable by default
	},
	is_symbol(key)
	{
		return key.startsWith('!!')
	},
	parse_leaf(leaf)
	{
		if(!(typeof leaf==='string'))
			return leaf//Idk why but i made bugs
		//This function is meant to be plugged into djson.parse's leaf_parser parameter as the default
		//Summary: try converting the leaf into a JSON-style value, and if we can't, just leave it as a string.
		console.assert(leaf!=null&&Object.getPrototypeOf(leaf)===String.prototype,'Leaf must be a string; leaf=',leaf)
		try
		{
			return JSON.parse(leaf)
		}catch{}
		const number=parsedSimpleMathFromString(leaf)//If this is undefined, it means it failed to parse the expression
		if(number!==undefined)
			return number
		//	OLD VERSION FOR DOING NUMBERS: if(leaf.match(/^\ *\-?\.\d+\ *$/))//A number like .234 isn't valid JSON number but is valid JS number// return Number(leaf)
		return leaf
	},
	parse_handwritten(lines,kwargs={})
	{
		//Removes trailing whitespace and empty lines (that just have whitespace) It's really just to help when we're actually writing them
		console.assert(arguments.length===1, 'djson.parse_handwritten takes exactly one argument')
		if(typeof lines==='string')
			lines=lines.split('\n')
		assert.isPureArray(lines)
		const out=[]
		for(let line of lines)
		{
			assert.isPrototypeOf(line,String)
			line=line.trimRight()
			if(line)
				out.push(line)
		}
		return djson.parse(out,kwargs)
	},
	applyDjsonDelta(o,d)//A simpler variant of deltas.apply that lets you rewrite deltas, making djson potentially very readable if written by hand
	{
		for(let key of Object.keys(d))
		{
			if(are_objects(o,d[key]) && key in o)
				djson.applyDjsonDelta(o[key],d[key])
			else
			{
				// Very important warning, but even this got annoying...
				// console.assert(!is_defined(o[key])||(is_object(o[key])===is_object(d[key])),'djson.parse error at line '+current_line_number+': Youre trying to overwrite a '+typeof o[key]+' with a '+typeof d[key]+' at line '+current_line_number+' at key '+JSON.stringify(key)+'. This is not allowed, as it could erase your previous entry of '+JSON.stringify(key)+' instead of merging them together.\nThe full line that caused the error: '+JSON.stringify(line)+'\nWhole djson shown below this line:\n'+numbered_lines_string(originalString))
				o[key] = d[key]
			}
		}
	},
	parse(lines,kwargs={})
	{
		const {
				  level                  =-1,
				  leaf_parser            =djson.parse_leaf,
				  macros                 =true,
				  delete_emptystring_keys=true,
				  baseCase               =true,
				  symbols_enabled        =djson.symbols_enabled,
				  symbol                 =djson.symbol,
			  }=kwargs

		//TODO: refactor macros, leaf_parser, and delete_emptystring_keys into some 'post-processing' method
		if(typeof lines==='string')
			lines=lines.split('\n')
		let out={}
		const originalNumberOfLines=lines.length
		const originalString=lines.join('\n')
		while(lines.length)
		{
			const line=lines.shift()
			const line_level=get_indent_level(line)
			if(line_level<=level)
			{
				lines.unshift(line)//Put it back again
				break
			}

			///////////////////////////////////////////////////////////////////

			const current_line_number=originalNumberOfLines-(lines.length)

			const trimmed=line.replace(/^\t*/,'')//Remove all tabs at the beginning of the line
			const entries=trimmed.split(/\t+/)//Split at every contiguous cluster of tabs

			const path=[]//This gets added to...

			const enable_keys_with_spaces=false//This will be added once I can get syntax highlighting working for it, which turns out to be tricky. 
			if(enable_keys_with_spaces)
			if(entries.length && entries[0].includes(' '))
			{
				const next_line=lines[0]
				if(entries.length>1||
					entries.length===1&&
					next_line!==undefined&&//We're not on the last line
					get_indent_level(next_line)>line_level//There's stuff to put in this key (that has spaces)
					)
				{
					path.push(entries.shift())//A special case
				}
			}

			for(let entry of entries)
			{
				console.assert(!entry.includes('\t'),'This is impossible unless djson.parse is broken.',entry)
				if(entry.includes(' '))
				{
					let [key,value]=split_on_first_space(entry)
					if(symbols_enabled&&key===symbol)
					{
						key=djson.random_symbol()
						// key=Math.random()+''
						// key=Symbol("ASODIJA")
					}
					//I disabled the below warnings simply because I found them annoying. But you might find them useful...so I didn't delete them
					//	if(false)if(value&&value!==value.trimLeft())console.warn('djson.parse warning at line '+current_line_number+': value starts with whitespace, which means you might have tried using spaces as indents: value==='+JSON.stringify(value))
					//	if(!value)                                  console.warn('djson.parse warning at line '+current_line_number+': value is empty! You must have had some line ending with key followed by a single space before the end of the line')
					djson.applyDjsonDelta(out,nested_path(path,{[key]:value}))
				}
				else
				{
					//if we're here, then entry IS a (purple) key that points to an object (as opposed to a string)
					if(symbols_enabled&&entry===symbol)
					{
						entry=djson.random_symbol()
					}
					path.push(entry)//Burrow deeper down the rabbit hole...
				}
			}

			djson.applyDjsonDelta(out,nested_path(path,djson.parse(lines,{...kwargs,level:line_level,baseCase:false})))

			//I disabled the below warnings simply because I found them annoying. But you might find them useful for debugging (they're not obsolete or anything)...so I didn't delete them
			//	if(false && key==='')   console.warn('djson.parse warning at line '+current_line_number+': key==="", which means you have a blank line somewherere')
			//	if(false && key in out) console.warn('djson.parse warning at line '+current_line_number+': key is not unique! key==='+JSON.stringify(key))
			//	console.assert(is_object(out))
		}

		if(delete_emptystring_keys)
		{
			out=djson_macros.deletedEmptyKeys(out)
		}
		if(baseCase)
		{
			used_keys={}
			if(macros && baseCase)
			{
				// return out
				// console.log("BEFOREOUT",out)
				out=djson_macros.macroized(out)
				// console.log("AFTEROUT",out)
				// console.log()
			}
			//POST PROCESSING SECTION UNTIL END OF FUNCTION
			function parse_leaves(object)
			{
				if(is_object(object))
				{
					const out={}
					for(const [key, value] of Object.entries(object))
					{
						out[key]=parse_leaves(value)
					}
					return out
				}
				else
				{
					return leaf_parser(object)
				}
			}
			// console.log('pre-parseley: ',out)
			out=parse_leaves(out)
		}
		return out
	},
	stringify(object,level=0,out=[],{symbols_enabled=djson.symbols_enabled,symbol=djson.symbol}={})
	{
		console.assert(is_object(object),'you can only djson-stringify objects, but argument "object" was of type '+typeof object)
		for(let [key,value] of Object.entries(object))
		{
			if(djson.is_symbol(key)&&symbols_enabled)
			{
				key=symbol
			}
			if(is_object(value))
			{
				out.push(multiply_string('\t',level)+key)
				djson.stringify(value,level+1,out)
			}
			else
			{
				// console.assert(key                ,'djson keys cannot be empty strings')
				console.assert(!key.includes(' ') ,'djson keys cannot contain spaces')
				console.assert(!key.includes('\t'),'djson keys cannot contain tabs')
				console.assert(!key.includes('\n'),'djson keys cannot contain newlines')
				if(typeof value!=='string')
				{
					//I disabled this warning becaue it's a fairly normal thing to happen and it got spammy: console.warn('Coersion warning: all djson values are strings, and typeof value==='+typeof value+' and String(value)==='+String(value)+' and key==='+key)
					value=String(value)
				}
				else if(value.includes('\n') || value.includes('\t'))
				{
					value=JSON.stringify(value)
				}
				console.assert(!value.includes('\n'),'no djson values may contain more than one line')
				// console.assert(!value.trim(),'djson values cannot be empty strings (for readability\'s sake')
				// console.assert(!value.trim(),'djson keys cannot be empty strings (for readability\'s sake')
				out.push(multiply_string('\t',level)+key+' '+value)
			}
		}
		return out.join('\n')
	},
	test(_djson)
	{
		//djson is SO important to this project that I HAVE to write at least SOME kind of tests for it...
		_djson=_djson||`test
1 
	2
	3
1
	4
	5
A
	B
	C
	a 
		b
	c
	d 
	e f 
	g 0
	g 1
	h 0
	i 0
		j
		k 3
	l
		m
		n 0
	*
		!
		? -
transform
	Pos
		X 3
		Y 2
		Z 0
	rot
		x 3
		y 2
		z 6
fluid
	level
		percent 5
	color
		r 4
		g 7
		b 1
	name elbow
people
	anh
		gender
			female
		last

	A 0
	B 1
	C 2
	D 3
	E 4
deltaTest
	Blah 4
	Blarh 5
deltaTest
	Blah 5
	Blem 9
deltaTest aposd
	`
		console.log("ORIGINAL:\n"+_djson)
		const object=djson.parse(_djson)
		console.log("DJSON PARSED:\n"+JSON.stringify(object))

		const stringified=djson.stringify(object)
		console.assert(typeof stringified === 'string')
		console.log("DJSON STRINGIFIED:\n"+stringified)
		const object2=djson.parse(stringified)
		console.log("DJSON RE-PARSED:\n"+JSON.stringify(object2,null,4))
		const stringified2=djson.stringify(object2)
		console.log("DJSON RE-STRINGIFIED:\n"+stringified2)
		console.assert(stringified===stringified2)
	},
})
// djson.test()
window.djson=djson