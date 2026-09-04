//Meant to be used for djson post-processing. Really the only important function in here is djson_macros.macroized.
used_keys={}
var djson_macros=proxies.argumentCountChecker({
	containsMacro(object,key)
	{
		console.warn('This function is UNTESTED! Beware!')
		//WARANING: UNUSED AND UNTESTED! I'M ONLY KEEPING THIS HERE IN-CASE I MIGHT NEED IT LATER,
		//as it would be a waste to just throw out this code. But before you use it, make sure it works!
		console.assert(arguments.length===2,'Wrong number of arguments')
		if(is_object(object))
		{
			if(key in object)
			{
				return true
			}
			else
			{
				for(const value of object)
				{
					if(djson_macros.containsMacro(value,key))
					{
						return true
					}
				}
				return false
			}
		}
		else if(isString(object))
		{
			return object.split('~').includes(key)
		}
		else
		{
			console.error('This function should be called on pure-djson output (AKA all-strings)')
			return false
		}
	},
	appliedMacros(object,macros,otherMacros)
	{
		console.assert(arguments.length===3,'Wrong number of arguments')
		assert.isPureObject(macros)
		assert.isPureObject(otherMacros)
		let out={}
		if(is_object(object))
		{
			for(let [key,value] of Object.entries(object))
			{
				if(key in used_keys && djson.is_symbol(key))
					key=djson.random_symbol()
				used_keys[key]={}//TODO FIX BUG HERE
				key  =djson_macros.appliedMacros(key,macros,otherMacros)
				value=djson_macros.appliedMacros(value,macros,otherMacros)
				out[key]=value
			}
			return out
		}
		else if(typeof object==='string')
		{
			let macroizeString=x=>x===''?'~':(x in macros&&(!is_object(macros[x]))?macros[x]:x)
			return ''+djson.parse_leaf(object.split('~').map(macroizeString).join(''))
		}
		else
		{
			console.error('This function should be called on pure-djson output (AKA all-strings)')
			return object
		}
	},
	transposed(object)
	{
		const out={}
		for(const [key1,value1] of Object.entries(object))
			for(const [key2,value2] of Object.entries(value1))
				if(out[key2]!==undefined)
					out[key2][key1]=value2
				else
					out[key2]={[key1]:value2}
		return out
	},
	purgeable(string,otherMacros)
	{
		console.assert(arguments.length===2,'Wrong number of arguments')
		assert.isString(string)
		assert.isPureObject(otherMacros)
		for(const chunk of string.split('~'))
		{
			if(chunk in otherMacros)
			{
				return true
			}
		}
		return false
	},
	purgedUnexpandedMacros(object,otherMacros)
	{
		console.assert(arguments.length===2,'Wrong number of arguments')
		if(!is_object(object))
		{
			return object
		}
		assert.isPureObject(otherMacros)
		//Delete all sections which have leftover macros in them
		let out={}
		for(let [key,value] of Object.entries(object))
		{
			if(djson_macros.purgeable(key,otherMacros))
			{
				continue
			}
			else if(typeof value==='string')
			{
				if(djson_macros.purgeable(value,otherMacros))
				{
					continue
				}
				else
				{
					out[key]=value
				}
			}
			else
			{
				// assert.isPureObject(value)
				out[key]=djson_macros.purgedUnexpandedMacros(value,otherMacros)
			}
		}
		return out
	},
	otherMacros(macros,allMacros)
	{
		const out={}
		for(const macro of Object.values(allMacros))
		{
			for(const key in macro)
			{
				if(!(key in macros))
				{
					out[key]=null
				}
			}
		}
		return out
	},
	deletedEmptyKeys(object)
	{
		if(!is_object(object))
			return object
		const out={}
		for(const [key,value] of Object.entries(object))
		{
			if(key.trim())
			{
				out[key]=djson_macros.deletedEmptyKeys(value)
			}
		}
		return out
	},
	composedMacros(object,macrosets)
	{
		console.assert(arguments.length===2,'Wrong number of arguments')
		assert.isPureObject(macrosets)
		macrosets=deltas.copied(macrosets)
		macrosets=djson_macros.deletedEmptyKeys(macrosets)
		for(const [key,value] of Object.entries(macrosets))
		{
			if(!is_object(value))
			{
				for(const macrosetKey in (macrosets))//Add this string-string key-value pair to any value which doesn't allready have an entry for that key
				{
					if(is_object(macrosets[macrosetKey]))
					{
						if(!(key in macrosets[macrosetKey]))
						{
							macrosets[macrosetKey][key]=value
						}
					}
				}
				macrosets[key]={[key]:value}//Also do stuff if there are no other macrosets...
			}
		}
		// console.log("\n")
		// console.log("MACROSETS",djson.stringify(macrosets))
		// console.log("\n")
		let out={}
		let allMacroKeys={}
		// console.log(macrosets)
		for(const macroset of Object.values(macrosets))
		{
			if(is_object(macroset))
			{
				for(key in macroset)
				{
					allMacroKeys[key]=null//Doesn't matter what the value is. It only matters that the key exists.
				}
			}
		}
		deltas.pour(out,djson_macros.purgedUnexpandedMacros(object,allMacroKeys))
		for(const macroset of Object.values(macrosets))
		{
			if(is_object(macroset))
			{
				const x=djson_macros.appliedMacros(object,macroset,djson_macros.otherMacros(macroset,allMacroKeys))
				// console.log(djson.stringify(x))
				deltas.pour(out,x)
			}
		}
		return out
	},
	macroized(object)
	{
		if(!is_object(object))
			return object
		let out={}
		for(let [key,value] of Object.entries(object))
			if(key!=='~')//Get through all the non-macros first...
				for(const KEY of key.split(','))
					if(is_object(value) && KEY!==''&&KEY[0]==='~')//We're in a scope
						 deltas.withoutDeletions(deltas.pour, out, djson_macros.macroized(value) )
					else deltas.withoutDeletions(deltas.pour, out, {[KEY]:djson_macros.macroized(value)})
		if('~' in object)
		{
			let macrosets=object['~']
			macrosets=djson_macros.macroized(macrosets)
			if(is_object(macrosets))
			{
				// console.log(macrosets)
				for(let [key,value] of Object.entries(macrosets))
				{
					if(typeof value!=='object')
					{
						// alert(key,value)
						macrosets[Symbol()]={[key]:value}
					}
				}
				macrosets=dictProduct(macrosets)
			}
			out=djson_macros.composedMacros(out,macrosets)
		}
		return out
	}
})


// testobject=djson.parse(`
// deltas	thing~N~move	position	x ~N	y ~M	x,y N~,~M
// `)

// testmacroset=djson.parse(`
// 0
// 	N Hello
// 	M Lesiq
// 1
// 	N Ryan
// 	M Burgert
// 2
// 	N cheese
// 
// 	M potato
// `)

// console.log(djson_macros.composedMacros(testobject,testmacroset))


// var macroizedtester=`

// deltas	pipe~pipe#~_to_slot~slot#
// 	universal
// ~
// 	universal universality
// 	0
// 		pipe# 11
// 		slot# 22
// 		universal override
// 	1
// 		pipe# a
// 		slot# b
// 	2
// 		pipe# A
// 		slot# B
// 	3
// 		pipe# aa
// 		slot# bb


// `



// console.log(djson.stringify(djson_macros.macroized(djson.parse(macroizedtester))))







